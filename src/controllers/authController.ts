import { Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import User from '../models/User.js'
import Tenant from '../models/Tenant.js'
import { AuthRequest } from '../middleware/auth.js'
import { isValidEmail, sanitizeEmail, validatePassword } from '../utils/validators.js'
import { createCustomer } from '../services/stripeService.js'
import logger from '../utils/logger.js'

const generateToken = (userId: string, tenantId: string): string => {
  return jwt.sign(
    { userId, tenantId },
    process.env.JWT_SECRET || 'your-super-secret-jwt-key',
    { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
  )
}

const generateRefreshToken = (): string => {
  return crypto.randomBytes(40).toString('hex')
}

export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, password, companyName } = req.body

    if (!name || !email || !password) {
      res.status(400).json({ error: 'Name, email, and password are required' })
      return
    }

    const sanitizedEmail = sanitizeEmail(email)
    if (!isValidEmail(sanitizedEmail)) {
      res.status(400).json({ error: 'Invalid email address' })
      return
    }

    const passwordValidation = validatePassword(password)
    if (!passwordValidation.valid) {
      res.status(400).json({ error: passwordValidation.message })
      return
    }

    const existingUser = await User.findOne({ email: sanitizedEmail })
    if (existingUser) {
      res.status(400).json({ error: 'Email already registered' })
      return
    }

    let stripeCustomerId: string | undefined
    try {
      const stripeCustomer = await createCustomer(sanitizedEmail, name)
      stripeCustomerId = stripeCustomer.id
    } catch (stripeError) {
      logger.warn('Stripe customer creation failed, continuing without:', stripeError)
    }

    const workspaceName = companyName || `${name}'s Workspace`
    const tenant = await Tenant.create({
      name: workspaceName,
      slug: workspaceName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Date.now().toString(36),
      stripeCustomerId,
      settings: {
        timezone: 'UTC',
        defaultFromName: name,
      },
    })

    const user = await User.create({
      name,
      email: sanitizedEmail,
      password,
      tenantId: tenant._id,
      role: 'admin',
      isActive: true,
    })

    const token = generateToken(user._id.toString(), tenant._id.toString())

    logger.info(`New user registered: ${sanitizedEmail}, tenant: ${tenant.slug}`)

    res.status(201).json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      tenant: {
        id: tenant._id,
        name: tenant.name,
        slug: tenant.slug,
        plan: tenant.plan,
      },
      tenantId: tenant._id,
    })
  } catch (error) {
    logger.error('Registration error:', error)
    res.status(500).json({ error: 'Registration failed. Please try again.' })
  }
}

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' })
      return
    }

    const sanitizedEmail = sanitizeEmail(email)
    
    const user = await User.findByEmail(sanitizedEmail)
    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' })
      return
    }

    if (!user.isActive) {
      res.status(401).json({ error: 'Account is deactivated. Please contact support.' })
      return
    }

    const isPasswordValid = await user.comparePassword(password)
    if (!isPasswordValid) {
      res.status(401).json({ error: 'Invalid credentials' })
      return
    }

    const tenant = await Tenant.findById(user.tenantId)
    if (!tenant || !tenant.isActive) {
      res.status(401).json({ error: 'Tenant is deactivated. Please contact support.' })
      return
    }

    user.lastLoginAt = new Date()
    await user.save()

    const token = generateToken(user._id.toString(), user.tenantId.toString())

    logger.info(`User logged in: ${sanitizedEmail}`)

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      tenant: {
        id: tenant._id,
        name: tenant.name,
        slug: tenant.slug,
        plan: tenant.plan,
        emailsUsed: tenant.emailsUsed,
        emailsLimit: tenant.emailsLimit,
      },
      tenantId: user.tenantId,
    })
  } catch (error) {
    logger.error('Login error:', error)
    res.status(500).json({ error: 'Login failed. Please try again.' })
  }
}

export const me = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }

    const user = await User.findById(req.user.id)
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    const tenant = await Tenant.findById(user.tenantId)
    if (!tenant) {
      res.status(404).json({ error: 'Tenant not found' })
      return
    }

    res.json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
        emailVerified: user.emailVerified,
        createdAt: user.createdAt,
      },
      tenant: {
        id: tenant._id,
        name: tenant.name,
        slug: tenant.slug,
        plan: tenant.plan,
        emailsUsed: tenant.emailsUsed,
        emailsLimit: tenant.emailsLimit,
        campaignsUsed: tenant.campaignsUsed,
        campaignsLimit: tenant.campaignsLimit,
        currentPeriodEnd: tenant.currentPeriodEnd,
        settings: tenant.settings,
      },
    })
  } catch (error) {
    logger.error('Me error:', error)
    res.status(500).json({ error: 'Failed to get user info' })
  }
}

export const refreshToken = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }

    const token = generateToken(req.user.id, req.user.tenantId)

    res.json({
      success: true,
      token,
    })
  } catch (error) {
    logger.error('Refresh token error:', error)
    res.status(500).json({ error: 'Failed to refresh token' })
  }
}

export const updateProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }

    const { name } = req.body
    
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { name },
      { new: true, runValidators: true }
    )

    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    res.json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    })
  } catch (error) {
    logger.error('Update profile error:', error)
    res.status(500).json({ error: 'Failed to update profile' })
  }
}

export const changePassword = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }

    const { currentPassword, newPassword } = req.body

    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: 'Current and new password are required' })
      return
    }

    const passwordValidation = validatePassword(newPassword)
    if (!passwordValidation.valid) {
      res.status(400).json({ error: passwordValidation.message })
      return
    }

    const user = await User.findById(req.user.id).select('+password')
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    const isCurrentPasswordValid = await user.comparePassword(currentPassword)
    if (!isCurrentPasswordValid) {
      res.status(401).json({ error: 'Current password is incorrect' })
      return
    }

    user.password = newPassword
    await user.save()

    logger.info(`Password changed for user: ${user.email}`)

    res.json({
      success: true,
      message: 'Password changed successfully',
    })
  } catch (error) {
    logger.error('Change password error:', error)
    res.status(500).json({ error: 'Failed to change password' })
  }
}
