import { Response, NextFunction } from 'express'
import { AuthRequest } from './auth.js'
import Tenant from '../models/Tenant.js'
import logger from '../utils/logger.js'

export interface TenantRequest extends AuthRequest {
  tenant?: {
    id: string
    name: string
    plan: string
    emailsUsed: number
    emailsLimit: number
  }
}

export const loadTenant = async (
  req: TenantRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' })
      return
    }

    const tenant = await Tenant.findById(req.user.tenantId)
    if (!tenant) {
      res.status(404).json({ error: 'Tenant not found' })
      return
    }

    req.tenant = {
      id: tenant._id.toString(),
      name: tenant.name,
      plan: tenant.plan,
      emailsUsed: tenant.emailsUsed,
      emailsLimit: tenant.emailsLimit,
    }

    next()
  } catch (error) {
    logger.error('Tenant loading error:', error)
    res.status(500).json({ error: 'Failed to load tenant' })
  }
}

export const checkEmailLimit = async (
  req: TenantRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  if (!req.tenant) {
    res.status(401).json({ error: 'Tenant required' })
    return
  }

  if (req.tenant.emailsUsed >= req.tenant.emailsLimit) {
    res.status(403).json({ error: 'Email limit reached. Please upgrade your plan.' })
    return
  }

  next()
}
