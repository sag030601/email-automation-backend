import { Response } from 'express'
import Campaign from '../models/Campaign.js'
import Contact from '../models/Contact.js'
import Tenant from '../models/Tenant.js'
import { TenantRequest } from '../middleware/tenant.js'
import { isValidObjectId } from '../utils/validators.js'
import { generatePersonalizedEmail } from '../services/groqService.js'
import { addBulkEmailsToQueue } from '../services/queueService.js'
import {
  indexTenantKnowledge,
  retrieveRelevantChunks,
  buildRetrievalQuery,
} from '../rag/index.js'
import logger from '../utils/logger.js'

function textToHtml(text: string): string {
  return text
    .split(/\n\n+/)
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('')
}

export const generateAiCampaign = async (req: TenantRequest, res: Response): Promise<void> => {
  try {
    if (!req.user || !req.tenant) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }

    const tenant = await Tenant.findById(req.user.tenantId)
    if (!tenant?.canCreateCampaign()) {
      res.status(403).json({
        error: 'Campaign limit reached. Please upgrade your plan.',
      })
      return
    }

    const { name, goal, tone, contactIds } = req.body as {
      name?: string
      goal?: string
      tone?: string
      contactIds?: string[]
    }

    if (!goal?.trim() || !tone?.trim()) {
      res.status(400).json({ error: 'Goal and tone are required' })
      return
    }

    if (!Array.isArray(contactIds) || contactIds.length === 0) {
      res.status(400).json({ error: 'Select at least one contact' })
      return
    }

    const invalidIds = contactIds.filter((id) => !isValidObjectId(id))
    if (invalidIds.length > 0) {
      res.status(400).json({ error: 'Invalid contact ID(s)' })
      return
    }

    const contacts = await Contact.find({
      _id: { $in: contactIds },
      tenantId: req.user.tenantId,
    })

    if (contacts.length === 0) {
      res.status(404).json({ error: 'No contacts found' })
      return
    }

    const campaignName = name?.trim() || `Campaign — ${new Date().toLocaleDateString()}`
    const generated: Array<{
      contactId: string
      email: string
      name: string
      subject: string
      body: string
      html: string
      ragChunks?: Array<{ source: string; text: string; score: number }>
      error?: string
    }> = []

    let indexedCount = 0
    try {
      indexedCount = await indexTenantKnowledge(req.user.tenantId)
    } catch (err) {
      logger.warn('RAG index failed, generating without context:', err)
    }

    const trimmedGoal = goal.trim()
    const trimmedTone = tone.trim()

    for (const contact of contacts) {
      try {
        let contextChunks: Awaited<ReturnType<typeof retrieveRelevantChunks>> = []
        try {
          const query = buildRetrievalQuery(trimmedGoal, trimmedTone, {
            name: contact.name,
            email: contact.email,
            notes: contact.notes,
          })
          contextChunks = await retrieveRelevantChunks(req.user.tenantId, query)
        } catch (ragErr) {
          logger.warn(`RAG retrieve failed for ${contact.email}:`, ragErr)
        }

        const email = await generatePersonalizedEmail(
          trimmedGoal,
          trimmedTone,
          {
            name: contact.name,
            email: contact.email,
            notes: contact.notes,
          },
          contextChunks
        )
        generated.push({
          contactId: contact._id.toString(),
          email: contact.email,
          name: contact.name,
          subject: email.subject,
          body: email.body,
          html: textToHtml(email.body),
          ragChunks: contextChunks.map((c) => ({
            source: c.source,
            text: c.text.slice(0, 200),
            score: Math.round(c.score * 1000) / 1000,
          })),
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Generation failed'
        generated.push({
          contactId: contact._id.toString(),
          email: contact.email,
          name: contact.name,
          subject: '',
          body: '',
          html: '',
          error: message,
        })
        logger.error(`Groq generation failed for ${contact.email}:`, err)
      }
    }

    const successful = generated.filter((g) => !g.error)
    if (successful.length === 0) {
      res.status(502).json({
        error: 'Failed to generate emails for all contacts',
        generated,
      })
      return
    }

    const first = successful[0]
    const recipients = successful.map((g) => ({
      email: g.email,
      name: g.name,
      contactId: g.contactId,
      subject: g.subject,
      content: g.html,
      variables: { bodyText: g.body },
    }))

    const campaign = await Campaign.create({
      tenantId: req.user.tenantId,
      createdBy: req.user.id,
      name: campaignName,
      subject: first.subject,
      content: first.html,
      contentType: 'html',
      recipients,
      status: 'draft',
      fromName: tenant.settings?.defaultFromName,
      fromEmail: tenant.settings?.defaultFromEmail,
      tags: ['ai'],
      metadata: {
        type: 'ai',
        goal: trimmedGoal,
        tone: trimmedTone,
        ragIndexedChunks: indexedCount,
        generatedAt: new Date().toISOString(),
        emails: generated,
      },
    })

    await Tenant.findByIdAndUpdate(req.user.tenantId, { $inc: { campaignsUsed: 1 } })

    indexTenantKnowledge(req.user.tenantId).catch((err) =>
      logger.warn('Post-campaign RAG re-index failed:', err)
    )

    logger.info(`AI campaign created: ${campaign._id}, ${successful.length} emails`)
    res.status(201).json({
      success: true,
      campaign,
      generated,
    })
  } catch (error) {
    logger.error('Generate AI campaign error:', error)
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to generate campaign',
    })
  }
}

export const sendAiCampaignBulk = async (req: TenantRequest, res: Response): Promise<void> => {
  try {
    if (!req.user || !req.tenant) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }

    const id = String(req.params.id)
    if (!isValidObjectId(id)) {
      res.status(400).json({ error: 'Invalid campaign ID' })
      return
    }

    const campaign = await Campaign.findOne({
      _id: id,
      tenantId: req.user.tenantId,
    })

    if (!campaign) {
      res.status(404).json({ error: 'Campaign not found' })
      return
    }

    if (!['draft', 'scheduled'].includes(campaign.status)) {
      res.status(400).json({ error: `Campaign cannot be sent (status: ${campaign.status})` })
      return
    }

    const readyRecipients = campaign.recipients.filter(
      (r) => r.subject && r.content
    )

    if (readyRecipients.length === 0) {
      res.status(400).json({ error: 'No personalized emails ready to send' })
      return
    }

    const tenant = await Tenant.findById(req.user.tenantId)
    if (!tenant?.canSendEmails(readyRecipients.length)) {
      res.status(403).json({
        error: 'Insufficient email credits',
        needed: readyRecipients.length,
        available: (tenant?.emailsLimit || 0) - (tenant?.emailsUsed || 0),
      })
      return
    }

    await Campaign.findByIdAndUpdate(id, {
      status: 'queued',
      sentAt: new Date(),
      recipients: readyRecipients,
    })

    await addBulkEmailsToQueue(
      campaign._id.toString(),
      req.user.tenantId,
      campaign.subject,
      campaign.content,
      readyRecipients.map((r) => ({
        email: r.email,
        name: r.name,
        subject: r.subject,
        html: r.content,
        variables: r.variables
          ? Object.fromEntries(
              r.variables instanceof Map
                ? r.variables.entries()
                : Object.entries(r.variables as Record<string, string>)
            )
          : undefined,
      })),
      {
        fromEmail: campaign.fromEmail,
        fromName: campaign.fromName,
        replyTo: campaign.replyTo,
      }
    )

    await Campaign.findByIdAndUpdate(id, { status: 'sending' })

    const updated = await Campaign.findById(id).select('-recipients')
    res.json({
      success: true,
      campaign: updated,
      message: `Bulk send queued for ${readyRecipients.length} recipients`,
    })
  } catch (error) {
    logger.error('Send AI campaign bulk error:', error)
    res.status(500).json({ error: 'Failed to send campaign' })
  }
}
