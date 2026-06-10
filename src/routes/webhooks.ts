import { Router, Request, Response } from 'express'
import express from 'express'
import { Webhook, WebhookVerificationError } from 'svix'
import { constructWebhookEvent, handleWebhook, isStripeEnabled } from '../services/stripeService.js'
import {
  normalizeResendWebhookData,
  processWebhookEvent,
  type WebhookEvent,
} from '../services/emailService.js'
import logger from '../utils/logger.js'

const router = Router()

router.post(
  '/stripe',
  express.raw({ type: 'application/json' }),
  async (req: Request, res: Response): Promise<void> => {
    if (!isStripeEnabled()) {
      res.status(503).json({ error: 'Stripe not configured' })
      return
    }

    const signature = req.headers['stripe-signature'] as string

    if (!signature) {
      logger.warn('Missing Stripe signature')
      res.status(400).json({ error: 'Missing signature' })
      return
    }

    try {
      const event = constructWebhookEvent(req.body, signature)
      if (!event) {
        res.status(400).json({ error: 'Failed to construct event' })
        return
      }
      await handleWebhook(event)
      
      logger.info(`Stripe webhook processed: ${event.type}`)
      res.json({ received: true })
    } catch (error) {
      logger.error('Stripe webhook error:', error)
      res.status(400).json({ error: 'Webhook signature verification failed' })
    }
  }
)

router.post(
  '/resend',
  express.raw({ type: 'application/json' }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const payload =
        req.body instanceof Buffer ? req.body.toString('utf8') : String(req.body ?? '')

      const secret = process.env.RESEND_WEBHOOK_SECRET?.trim()
      if (secret) {
        const wh = new Webhook(secret)
        wh.verify(payload, {
          'svix-id': req.get('svix-id') ?? '',
          'svix-timestamp': req.get('svix-timestamp') ?? '',
          'svix-signature': req.get('svix-signature') ?? '',
        })
      }

      const body = JSON.parse(payload) as {
        type?: string
        data?: WebhookEvent['data'] | Record<string, unknown>
        created_at?: string
      }

      const { type, data: rawData, created_at } = body

      if (!type || !rawData || typeof rawData !== 'object') {
        res.status(400).json({ error: 'Invalid webhook payload' })
        return
      }

      const normalized = normalizeResendWebhookData(rawData)
      if (!normalized.email_id) {
        logger.warn('Resend webhook missing email_id:', { type })
        res.status(400).json({ error: 'Missing email_id' })
        return
      }

      const event: WebhookEvent = {
        type,
        created_at: created_at || new Date().toISOString(),
        data: normalized as WebhookEvent['data'],
      }

      logger.info(`Resend webhook inbound: ${type} email_id=${normalized.email_id}`)

      await processWebhookEvent(event)

      logger.info(`Resend webhook handled: ${type}`)

      res.json({ received: true })
    } catch (error) {
      if (error instanceof WebhookVerificationError) {
        logger.warn('Invalid Resend webhook signature')
        res.status(401).json({ error: 'Invalid signature' })
        return
      }
      logger.error('Resend webhook error:', error)
      res.status(500).json({ error: 'Webhook processing failed' })
    }
  }
)

router.get('/health', (_req: Request, res: Response): void => {
  res.json({ status: 'ok', message: 'Webhooks endpoint is healthy' })
})

/**
 * DEV ONLY: Simulate Resend `email.opened` without Svix verification.
 * POST /api/webhooks/simulate-open  JSON body: { emailId: string, to?, from?, subject?, tags? }
 */
if (process.env.NODE_ENV !== 'production') {
  router.post(
    '/simulate-open',
    express.json(),
    async (req: Request, res: Response): Promise<void> => {
      const emailId =
        typeof req.body?.emailId === 'string' ? req.body.emailId.trim() : ''
      if (!emailId) {
        res.status(400).json({ error: 'Missing emailId to simulate' })
        return
      }

      const toRaw = req.body?.to as string | string[] | undefined
      const to = Array.isArray(toRaw)
        ? toRaw.map((x) => String(x))
        : typeof toRaw === 'string' && toRaw
          ? [toRaw]
          : []

      const from =
        typeof req.body?.from === 'string' && req.body.from
          ? req.body.from
          : 'onboarding@resend.dev'
      const subject =
        typeof req.body?.subject === 'string' && req.body.subject
          ? req.body.subject
          : 'Simulated Test Email'
      const tags =
        req.body?.tags &&
        typeof req.body.tags === 'object' &&
        !Array.isArray(req.body.tags)
          ? Object.fromEntries(
              Object.entries(req.body.tags as Record<string, unknown>).map(([k, v]) => [
                k,
                v === null || v === undefined ? '' : String(v),
              ])
            )
          : undefined

      const mockRaw: Record<string, unknown> = {
        email_id: emailId,
        from,
        to,
        subject,
        created_at: new Date().toISOString(),
        ...(tags !== undefined ? { tags } : {}),
      }

      try {
        const normalized = normalizeResendWebhookData(mockRaw)
        if (!normalized.email_id) {
          res.status(400).json({ error: 'Missing email_id after normalization' })
          return
        }

        const event: WebhookEvent = {
          type: 'email.opened',
          created_at: new Date().toISOString(),
          data: normalized,
        }

        logger.warn(
          `[dev] simulate-open: invoking processWebhookEvent for email_id=${emailId}`
        )
        await processWebhookEvent(event)
        res.status(200).json({ message: `Successfully simulated OPEN for ${emailId}` })
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Simulation failed'
        logger.error('[dev] simulate-open error:', error)
        res.status(500).json({ error: msg })
      }
    }
  )
}

export default router
