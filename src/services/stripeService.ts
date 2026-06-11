import Stripe from 'stripe'
import Tenant from '../models/Tenant.js'
import logger from '../utils/logger.js'

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY
const isStripeConfigured = Boolean(
  STRIPE_KEY && STRIPE_KEY !== 'sk_test_your_stripe_secret_key'
)

let stripe: Stripe | null = null
if (isStripeConfigured && STRIPE_KEY) {
  stripe = new Stripe(STRIPE_KEY, {
    apiVersion: '2026-04-22.dahlia',
  })
}

export const createCustomer = async (
  email: string,
  name: string
): Promise<Stripe.Customer | { id: string }> => {
  if (!stripe) {
    logger.warn('Stripe not configured, returning mock customer')
    return { id: `mock_cus_${Date.now()}` }
  }
  return stripe.customers.create({ email, name })
}

export const createCheckoutSession = async (
  tenantId: string,
  customerId: string,
  priceId: string
): Promise<Stripe.Checkout.Session | null> => {
  if (!stripe) {
    logger.warn('Stripe not configured, cannot create checkout session')
    return null
  }
  return stripe.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    mode: 'subscription',
    success_url: `${process.env.FRONTEND_URL}/billing?success=true`,
    cancel_url: `${process.env.FRONTEND_URL}/billing?canceled=true`,
    metadata: { tenantId },
  })
}

export const createPortalSession = async (
  customerId: string
): Promise<Stripe.BillingPortal.Session | null> => {
  if (!stripe) {
    logger.warn('Stripe not configured, cannot create portal session')
    return null
  }
  return stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${process.env.FRONTEND_URL}/billing`,
  })
}

export const handleWebhook = async (
  event: Stripe.Event
): Promise<void> => {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      const tenantId = session.metadata?.tenantId
      if (tenantId && session.subscription) {
        await Tenant.findByIdAndUpdate(tenantId, {
          stripeSubscriptionId: session.subscription as string,
          plan: 'basic',
        })
        logger.info(`Subscription created for tenant ${tenantId}`)
      }
      break
    }

    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription
      const tenant = await Tenant.findOne({ stripeSubscriptionId: subscription.id })
      if (tenant) {
        const priceId = subscription.items.data[0]?.price.id
        let plan: 'free' | 'basic' | 'pro' | 'enterprise' = 'free'
        
        if (priceId === process.env.STRIPE_PRICE_ID_BASIC) plan = 'basic'
        else if (priceId === process.env.STRIPE_PRICE_ID_PRO) plan = 'pro'
        else if (priceId === process.env.STRIPE_PRICE_ID_ENTERPRISE) plan = 'enterprise'

        const subscriptionItem = subscription.items.data[0]
        await Tenant.findByIdAndUpdate(tenant._id, {
          plan,
          ...(subscriptionItem?.current_period_start != null
            ? { currentPeriodStart: new Date(subscriptionItem.current_period_start * 1000) }
            : {}),
          ...(subscriptionItem?.current_period_end != null
            ? { currentPeriodEnd: new Date(subscriptionItem.current_period_end * 1000) }
            : {}),
        })
        logger.info(`Subscription updated for tenant ${tenant._id}`)
      }
      break
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription
      const tenant = await Tenant.findOne({ stripeSubscriptionId: subscription.id })
      if (tenant) {
        await Tenant.findByIdAndUpdate(tenant._id, {
          plan: 'free',
          stripeSubscriptionId: undefined,
        })
        logger.info(`Subscription canceled for tenant ${tenant._id}`)
      }
      break
    }

    default:
      logger.info(`Unhandled event type: ${event.type}`)
  }
}

export const constructWebhookEvent = (
  payload: Buffer,
  signature: string
): Stripe.Event | null => {
  if (!stripe) {
    logger.warn('Stripe not configured, cannot construct webhook event')
    return null
  }
  return stripe.webhooks.constructEvent(
    payload,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET || ''
  )
}

export const isStripeEnabled = (): boolean => isStripeConfigured

export { stripe }
