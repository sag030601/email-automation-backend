import mongoose from 'mongoose'
import { Resend } from 'resend'
import Campaign, { type ICampaignStats } from '../models/Campaign.js'
import EmailEvent, { type IEmailEvent } from '../models/EmailEvent.js'
import logger from '../utils/logger.js'

let resend: Resend | null = null
let resendInitialized = false

/** Hostnames we already PATCHed open/click tracking for (avoid repeated domains.update calls). */
const resendDomainsTrackingSynced = new Set<string>()

function shouldEnableResendTrackingViaDomainsApi(): boolean {
  const v = process.env.RESEND_ENABLE_TRACKING?.trim().toLowerCase()
  if (v === 'false' || v === '0' || v === 'off' || v === 'no') return false
  return true
}

/** Parse domain from `"Name <a@domain.com>"` or `a@domain.com`. */
function extractHostFromFromHeader(fromRaw: string): string | null {
  const trimmed = fromRaw.trim()
  const bracket = trimmed.match(/<([^<>]+@[^<>]+)>/)
  const addr = bracket ? bracket[1].trim() : trimmed
  const at = addr.lastIndexOf('@')
  if (at <= 0 || at === addr.length - 1) return null
  return addr.slice(at + 1).toLowerCase()
}

/**
 * Open/click tracking is controlled on the verified domain in Resend (not on emails.send payload).
 * When enabled via env, we PATCH `open_tracking` + `click_tracking` on the sender's domain record once per host.
 */
async function ensureResendOpenClickTrackingForSender(fromHeader: string): Promise<void> {
  if (!shouldEnableResendTrackingViaDomainsApi()) return

  const client = getResendClient()
  if (!client) return

  const host = extractHostFromFromHeader(fromHeader)
  if (!host || host === 'resend.dev' || host.endsWith('.resend.dev')) return
  if (resendDomainsTrackingSynced.has(host)) return

  try {
    const { data: listData, error: listErr } = await client.domains.list()
    if (listErr) {
      logger.warn(`Resend domains.list failed; tracking sync skipped: ${listErr.message}`)
      return
    }

    const domainsList = Array.isArray(listData?.data) ? listData.data : []
    const domainRow = domainsList.find((d) => d.name?.toLowerCase() === host)

    if (!domainRow?.id) {
      logger.warn(
        `Sender domain "${host}" is not in your Resend account (Domains). Tracking cannot be enabled via API until the domain exists; add or verify it in the Resend dashboard.`
      )
      resendDomainsTrackingSynced.add(host)
      return
    }

    const { error: patchErr } = await client.domains.update({
      id: domainRow.id,
      openTracking: true,
      clickTracking: true,
    })

    if (patchErr) {
      logger.warn(
        `Resend domains.update (open/click tracking) failed for ${host}: ${patchErr.message}. ` +
          'Verify the domain and tracking DNS records in Resend → Domains, or toggle tracking manually.'
      )
      return
    }

    resendDomainsTrackingSynced.add(host)
    logger.info(`Enabled Resend open + click tracking (Domains API) for ${host}`)
  } catch (e) {
    logger.warn(`Resend tracking sync failed for ${host}: ${e instanceof Error ? e.message : String(e)}`)
  }
}

const getResendClient = (): Resend | null => {
  if (resendInitialized) {
    return resend
  }
  
  const apiKey = process.env.RESEND_API_KEY
  if (apiKey && apiKey.startsWith('re_')) {
    resend = new Resend(apiKey)
    logger.info('Resend client initialized successfully')
  } else {
    logger.warn('Resend API key not found or invalid - emails will be simulated')
  }
  resendInitialized = true
  return resend
}

export interface SendEmailOptions {
  to: string | string[]
  subject: string
  html: string
  text?: string
  from?: string
  replyTo?: string
  tags?: { name: string; value: string }[]
  headers?: Record<string, string>
}

export interface EmailResult {
  success: boolean
  id?: string
  error?: string
}

export interface WebhookEvent {
  type: string
  created_at: string
  data: {
    email_id: string
    from: string
    to: string[]
    subject: string
    created_at: string
    tags?: Record<string, string>
    click?: { link: string; timestamp: string }
    bounce?: { message: string; type: string }
  }
}

/** Resend may send `tags` as object or as {name,value}[] — normalize for matching. */
export const normalizeResendWebhookData = (
  raw: Record<string, unknown>
): WebhookEvent['data'] => {
  const email_id = typeof raw.email_id === 'string' ? raw.email_id : ''
  const from = typeof raw.from === 'string' ? raw.from : ''
  const to = Array.isArray(raw.to)
    ? (raw.to as unknown[]).map((x) => String(x))
    : typeof raw.to === 'string'
      ? [raw.to]
      : []
  const subject = typeof raw.subject === 'string' ? raw.subject : ''
  const created_at =
    typeof raw.created_at === 'string' ? raw.created_at : new Date().toISOString()

  let tags: Record<string, string> | undefined
  const rt = raw.tags
  if (rt && typeof rt === 'object') {
    if (Array.isArray(rt)) {
      const entries = (rt as { name?: string; value?: string }[])
        .filter((x) => x?.name != null && x?.value != null)
        .map((x) => [String(x.name), String(x.value)])
      tags = Object.fromEntries(entries)
    } else {
      tags = Object.fromEntries(
        Object.entries(rt as Record<string, unknown>).map(([k, v]) => [
          k,
          v === null || v === undefined ? '' : String(v),
        ])
      )
    }
  }

  const base: WebhookEvent['data'] = {
    email_id,
    from,
    to,
    subject,
    created_at,
    tags,
  }
  if (raw.click && typeof raw.click === 'object') {
    base.click = raw.click as WebhookEvent['data']['click']
  }
  if (raw.bounce && typeof raw.bounce === 'object') {
    base.bounce = raw.bounce as WebhookEvent['data']['bounce']
  }
  return base
}

export const sendEmail = async (options: SendEmailOptions): Promise<EmailResult> => {
  const client = getResendClient()
  
  if (!client) {
    logger.warn('Resend not configured, simulating email send')
    return { 
      success: true, 
      id: `simulated_${Date.now()}_${Math.random().toString(36).substr(2, 9)}` 
    }
  }

  try {
    const payload = {
      from: options.from || process.env.FROM_EMAIL || 'onboarding@resend.dev',
      to: Array.isArray(options.to) ? options.to : [options.to],
      subject: options.subject,
      html: options.html,
      text: options.text,
      reply_to: options.replyTo,
      tags: options.tags,
      headers: options.headers,
    }
    
    logger.info(`Sending email via Resend: from=${payload.from}, to=${payload.to.join(',')}, subject=${payload.subject}`)

    await ensureResendOpenClickTrackingForSender(String(payload.from))

    const { data, error } = await client.emails.send(payload)

    if (error) {
      logger.error('Resend API error:', { error, payload: { from: payload.from, to: payload.to } })
      return { success: false, error: error.message }
    }

    logger.info(`Email sent successfully via Resend: id=${data?.id}, to=${payload.to.join(',')}`)

    if (String(payload.from).includes('@resend.dev')) {
      logger.warn(
        'Using @resend.dev: open/click tracking usually requires your own verified domain with ' +
          'open_tracking + a verified tracking subdomain in Resend (Domains). Otherwise email.opened may never fire.'
      )
    }

    return { success: true, id: data?.id }
  } catch (error) {
    logger.error('Email send error:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export const sendBatchEmails = async (
  emails: Array<{
    to: string
    subject: string
    html: string
    from?: string
    replyTo?: string
  }>
): Promise<EmailResult[]> => {
  const results: EmailResult[] = []
  const batchSize = 10
  const delayBetweenBatches = 1000

  for (let i = 0; i < emails.length; i += batchSize) {
    const batch = emails.slice(i, i + batchSize)
    
    const batchPromises = batch.map((email) =>
      sendEmail({
        to: email.to,
        subject: email.subject,
        html: email.html,
        from: email.from,
        replyTo: email.replyTo,
      })
    )

    const batchResults = await Promise.all(batchPromises)
    results.push(...batchResults)

    if (i + batchSize < emails.length) {
      await new Promise((resolve) => setTimeout(resolve, delayBetweenBatches))
    }
  }

  return results
}

/** Maps Resend webhook `type` → stored EmailEvent.type + optional Campaign.stats increment key. */
type WebhookHandler =
  | 'skip'
  | {
      eventType: IEmailEvent['type']
      /** Key on `Campaign.stats` to $inc (must exist on ICampaignStats) */
      campaignStat?: keyof ICampaignStats
    }

const RESEND_WEBHOOK_ROUTING: Record<string, WebhookHandler> = {
  // We already record "sent" when the queue completes; Resend duplicates this.
  'email.sent': 'skip',

  'email.delivered': { eventType: 'delivered', campaignStat: 'delivered' },
  'email.opened': { eventType: 'opened', campaignStat: 'opened' },
  'email.clicked': { eventType: 'clicked', campaignStat: 'clicked' },
  'email.bounced': { eventType: 'bounced', campaignStat: 'bounced' },
  'email.complained': { eventType: 'complained', campaignStat: 'complained' },
  'email.unsubscribed': { eventType: 'unsubscribed', campaignStat: 'unsubscribed' },
  'email.failed': { eventType: 'failed', campaignStat: 'failed' },
  'email.delivery_delayed': { eventType: 'delivery_delayed', campaignStat: 'delayed' },
  'email.suppressed': { eventType: 'suppressed', campaignStat: 'suppressed' },

  // Audit-only in EmailEvent (no aggregate counters on Campaign)
  'email.received': { eventType: 'received' },
  'email.scheduled': { eventType: 'scheduled' },
}

export const processWebhookEvent = async (event: WebhookEvent): Promise<void> => {
  const { type, data } = event

  logger.info(`Processing Resend webhook: ${type} for email_id=${data.email_id}`)

  const routing = RESEND_WEBHOOK_ROUTING[type]
  if (routing === undefined) {
    logger.warn(`Unhandled Resend webhook type: ${type} — add it to RESEND_WEBHOOK_ROUTING in emailService.ts`)
    return
  }
  if (routing === 'skip') {
    logger.debug(`Skipping ${type} (duplicate or not needed for stats)`)
    return
  }

  const { eventType, campaignStat } = routing

  let existingSentEvent = await EmailEvent.findOne({
    type: 'sent',
    'metadata.resendId': data.email_id,
  })

  const recipient = data.to?.[0]?.toLowerCase()
  const tagCampaign = data.tags?.campaign_id

  if (!existingSentEvent && recipient && tagCampaign) {
    const cid = String(tagCampaign)
    if (mongoose.Types.ObjectId.isValid(cid)) {
      existingSentEvent = await EmailEvent.findOne({
        type: 'sent',
        campaignId: cid,
        email: recipient,
      })
    }
  }

  if (!existingSentEvent) {
    logger.warn(
      `No matching send record for resendId=${data.email_id} (${type}). ` +
        'Ensure webhooks point to /api/webhooks/resend; outbound mail includes tags campaign_id / tenant_id.'
    )
    return
  }

  const { tenantId, campaignId, email } = existingSentEvent

  const existingEvent = await EmailEvent.findOne({
    campaignId,
    email,
    type: eventType,
  })

  if (!existingEvent) {
    await EmailEvent.create({
      tenantId,
      campaignId,
      email,
      type: eventType,
      metadata: {
        resendId: data.email_id,
        resendEventType: type,
        timestamp: data.created_at,
        ...data,
      },
    })

    if (campaignStat) {
      await Campaign.findByIdAndUpdate(campaignId, { $inc: { [`stats.${campaignStat}`]: 1 } })
    }

    logger.info(`Recorded ${eventType} (${type}) for campaign ${campaignId}`)
  }
}

export const getCampaignStats = async (campaignId: string): Promise<Record<string, number>> => {
  const events = await EmailEvent.aggregate([
    { $match: { campaignId } },
    { $group: { _id: '$type', count: { $sum: 1 } } },
  ])

  return events.reduce(
    (acc, event) => {
      acc[event._id] = event.count
      return acc
    },
    {} as Record<string, number>
  )
}

export const validateEmailDomain = async (domain: string): Promise<boolean> => {
  const client = getResendClient()
  if (!client) {
    return true
  }

  try {
    const { data } = await client.domains.list()
    return data?.data?.some((d) => d.name === domain) || false
  } catch (error) {
    logger.error('Failed to validate email domain:', error)
    return false
  }
}

export const getEmailStatus = async (emailId: string): Promise<unknown> => {
  const client = getResendClient()
  if (!client) {
    return { status: 'simulated' }
  }

  try {
    const { data } = await client.emails.get(emailId)
    return data
  } catch (error) {
    logger.error('Failed to get email status:', error)
    return null
  }
}
