import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import User from '../models/User.js'
import logger from '../utils/logger.js'

export interface AuthRequest extends Request {
  user?: {
    id: string
    email: string
    tenantId: string
    role: string
  }
}

export const authenticate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Authentication required' })
      return
    }

    const token = authHeader.split(' ')[1]
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret') as {
      userId: string
      tenantId: string
    }

    const user = await User.findById(decoded.userId)
    if (!user) {
      res.status(401).json({ error: 'User not found' })
      return
    }

    req.user = {
      id: user._id.toString(),
      email: user.email,
      tenantId: user.tenantId.toString(),
      role: user.role,
    }

    next()
  } catch (error) {
    logger.error('Authentication error:', error)
    res.status(401).json({ error: 'Invalid token' })
  }
}

export const requireRole = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' })
      return
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient permissions' })
      return
    }
    next()
  }
}
