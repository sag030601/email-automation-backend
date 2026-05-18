import { Response } from 'express'
import Tenant from '../models/Tenant.js'
import { TenantRequest } from '../middleware/tenant.js'
import { createCheckoutSession, createPortalSession } from '../services/stripeService.js'
import logger from '../utils/logger.js'

export const getSubscription = async (req: TenantRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }

    const tenant = await Tenant.findById(req.user.tenantId)
    if (!tenant) {
      res.status(404).json({ error: 'Tenant not found' })
      return
    }

    res.json({
      subscription: {
        planId: tenant.plan,
        status: tenant.stripeSubscriptionId ? 'active' : 'inactive',
        currentPeriodEnd: tenant.currentPeriodEnd,
        emailsUsed: tenant.emailsUsed,
        emailsLimit: tenant.emailsLimit,
      },
    })
  } catch (error) {
    logger.error('Get subscription error:', error)
    res.status(500).json({ error: 'Failed to fetch subscription' })
  }
}

export const createCheckout = async (req: TenantRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }

    const { planId } = req.body
    if (!planId) {
      res.status(400).json({ error: 'Plan ID is required' })
      return
    }

    const tenant = await Tenant.findById(req.user.tenantId)
    if (!tenant) {
      res.status(404).json({ error: 'Tenant not found' })
      return
    }

    if (!tenant.stripeCustomerId) {
      res.status(400).json({ error: 'Stripe customer not found' })
      return
    }

    const priceIdMap: Record<string, string | undefined> = {
      basic: process.env.STRIPE_PRICE_ID_BASIC,
      pro: process.env.STRIPE_PRICE_ID_PRO,
      enterprise: process.env.STRIPE_PRICE_ID_ENTERPRISE,
    }

    const priceId = priceIdMap[planId]
    if (!priceId) {
      res.status(400).json({ error: 'Invalid plan ID' })
      return
    }

    const session = await createCheckoutSession(
      tenant._id.toString(),
      tenant.stripeCustomerId,
      priceId
    )

    res.json({ url: session.url })
  } catch (error) {
    logger.error('Create checkout error:', error)
    res.status(500).json({ error: 'Failed to create checkout session' })
  }
}

export const createPortal = async (req: TenantRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }

    const tenant = await Tenant.findById(req.user.tenantId)
    if (!tenant) {
      res.status(404).json({ error: 'Tenant not found' })
      return
    }

    if (!tenant.stripeCustomerId) {
      res.status(400).json({ error: 'Stripe customer not found' })
      return
    }

    const session = await createPortalSession(tenant.stripeCustomerId)

    res.json({ url: session.url })
  } catch (error) {
    logger.error('Create portal error:', error)
    res.status(500).json({ error: 'Failed to create portal session' })
  }
}
