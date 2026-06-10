import Tenant from '../models/Tenant.js'
import Campaign from '../models/Campaign.js'
import Contact from '../models/Contact.js'
import EmailEvent from '../models/EmailEvent.js'
import type { RawChunk } from './types.js'

const MAX_CAMPAIGNS = 30
const MAX_EVENTS_PER_CONTACT = 10

export async function collectChunks(tenantId: string): Promise<RawChunk[]> {
  const chunks: RawChunk[] = []
  const tenant = await Tenant.findById(tenantId)
  if (!tenant) return chunks

  chunks.push({
    source: 'company',
    sourceId: tenantId,
    text: [
      `Company: ${tenant.name}`,
      tenant.settings?.defaultFromName
        ? `Default sender: ${tenant.settings.defaultFromName}`
        : '',
      tenant.settings?.defaultFromEmail
        ? `From email: ${tenant.settings.defaultFromEmail}`
        : '',
      `Plan: ${tenant.plan}`,
    ]
      .filter(Boolean)
      .join('. '),
  })

  const campaigns = await Campaign.find({ tenantId })
    .sort({ createdAt: -1 })
    .limit(MAX_CAMPAIGNS)
    .select('name subject status stats metadata recipients sentAt')

  for (const c of campaigns) {
    const meta = (c.metadata || {}) as { goal?: string; tone?: string; emails?: Array<{ email: string; subject?: string; body?: string }> }
    const goal = meta.goal ? `Goal: ${meta.goal}.` : ''
    const tone = meta.tone ? `Tone: ${meta.tone}.` : ''
    chunks.push({
      source: 'campaign',
      sourceId: c._id.toString(),
      text: [
        `Campaign "${c.name}"`,
        goal,
        tone,
        `Subject: ${c.subject}`,
        `Status: ${c.status}`,
        c.stats?.sent ? `Sent: ${c.stats.sent}` : '',
        c.stats?.opened ? `Opened: ${c.stats.opened}` : '',
        c.sentAt ? `Sent at: ${c.sentAt.toISOString().slice(0, 10)}` : '',
      ]
        .filter(Boolean)
        .join(' '),
    })

    for (const r of c.recipients.slice(0, 50)) {
      const emailMeta = meta.emails?.find((e) => e.email === r.email)
      if (emailMeta?.subject || emailMeta?.body) {
        chunks.push({
          source: 'contact',
          sourceId: r.contactId,
          contactId: r.contactId,
          text: `Past email to ${r.name || r.email} in campaign "${c.name}": Subject: ${emailMeta.subject || r.subject || c.subject}. ${emailMeta.body ? `Body excerpt: ${emailMeta.body.slice(0, 400)}` : ''}`,
        })
      }
    }
  }

  const contacts = await Contact.find({ tenantId })
  for (const contact of contacts) {
    const contactId = contact._id.toString()
    chunks.push({
      source: 'contact',
      sourceId: contactId,
      contactId,
      text: [
        `Contact: ${contact.name}`,
        `Email: ${contact.email}`,
        contact.notes ? `Notes: ${contact.notes}` : '',
      ]
        .filter(Boolean)
        .join('. '),
    })

    const events = await EmailEvent.find({
      tenantId,
      email: contact.email,
    })
      .sort({ createdAt: -1 })
      .limit(MAX_EVENTS_PER_CONTACT)
      .lean()

    const campaignIds = [...new Set(events.map((e) => String(e.campaignId)))]
    const campaignNames = await Campaign.find({ _id: { $in: campaignIds } })
      .select('name')
      .lean()
    const nameById = new Map(campaignNames.map((c) => [String(c._id), c.name]))

    for (const ev of events) {
      const campName = nameById.get(String(ev.campaignId)) || 'unknown'
      chunks.push({
        source: 'contact',
        sourceId: contactId,
        contactId,
        text: `Contact history: ${contact.name} (${contact.email}) — ${ev.type} for campaign "${campName}" on ${new Date(ev.createdAt).toISOString().slice(0, 10)}`,
      })
    }
  }

  return chunks.filter((c) => c.text.trim().length > 10)
}
