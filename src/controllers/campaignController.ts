import { Response } from 'express'
import Campaign from '../models/Campaign.js'
import Tenant from '../models/Tenant.js'
import { TenantRequest } from '../middleware/tenant.js'
import { isValidObjectId } from '../utils/validators.js'
import { addBulkEmailsToQueue, getQueueStats } from '../services/queueService.js'
import logger from '../utils/logger.js'

export const getCampaigns = async (req: TenantRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }

    const { status, page = 1, limit = 20, search } = req.query
    const skip = (Number(page) - 1) * Number(limit)

    const query: Record<string, unknown> = { tenantId: req.user.tenantId }
    
    if (status && status !== 'all') {
      query.status = status
    }
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { subject: { $regex: search, $options: 'i' } },
      ]
    }

    const [campaigns, total] = await Promise.all([
      Campaign.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .select('-recipients'),
      Campaign.countDocuments(query),
    ])

    res.json({
      success: true,
      campaigns,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      },
    })
  } catch (error) {
    logger.error('Get campaigns error:', error)
    res.status(500).json({ error: 'Failed to fetch campaigns' })
  }
}

export const getCampaign = async (req: TenantRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }

    const { id } = req.params
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

    res.json({ success: true, campaign })
  } catch (error) {
    logger.error('Get campaign error:', error)
    res.status(500).json({ error: 'Failed to fetch campaign' })
  }
}

export const createCampaign = async (req: TenantRequest, res: Response): Promise<void> => {
  try {
    if (!req.user || !req.tenant) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }

    const tenant = await Tenant.findById(req.user.tenantId)
    if (!tenant?.canCreateCampaign()) {
      res.status(403).json({ 
        error: 'Campaign limit reached. Please upgrade your plan.',
        limit: tenant?.campaignsLimit,
        used: tenant?.campaignsUsed,
      })
      return
    }

    const { 
      name, 
      subject, 
      previewText,
      content, 
      contentType = 'html',
      recipients = [], 
      scheduledAt,
      fromName,
      fromEmail,
      replyTo,
      tags = [],
    } = req.body

    if (!name || !subject || !content) {
      res.status(400).json({ error: 'Name, subject, and content are required' })
      return
    }

    const processedRecipients = recipients.map((r: string | { email: string; name?: string; variables?: Record<string, string> }) => {
      if (typeof r === 'string') {
        return { email: r.toLowerCase().trim() }
      }
      return {
        email: r.email.toLowerCase().trim(),
        name: r.name,
        variables: r.variables,
      }
    })

    const campaign = await Campaign.create({
      tenantId: req.user.tenantId,
      createdBy: req.user.id,
      name,
      subject,
      previewText,
      content,
      contentType,
      recipients: processedRecipients,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
      status: scheduledAt ? 'scheduled' : 'draft',
      fromName: fromName || req.tenant.settings?.defaultFromName,
      fromEmail: fromEmail || req.tenant.settings?.defaultFromEmail,
      replyTo,
      tags,
    })

    await Tenant.findByIdAndUpdate(req.user.tenantId, { $inc: { campaignsUsed: 1 } })

    logger.info(`Campaign created: ${campaign._id} by user ${req.user.id}`)
    res.status(201).json({ success: true, campaign })
  } catch (error) {
    logger.error('Create campaign error:', error)
    res.status(500).json({ error: 'Failed to create campaign' })
  }
}

export const updateCampaign = async (req: TenantRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }

    const { id } = req.params
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
      res.status(400).json({ error: 'Can only edit draft or scheduled campaigns' })
      return
    }

    const { 
      name, 
      subject, 
      previewText,
      content, 
      recipients, 
      scheduledAt,
      fromName,
      fromEmail,
      replyTo,
      tags,
    } = req.body

    const updates: Record<string, unknown> = {}

    if (name !== undefined) updates.name = name
    if (subject !== undefined) updates.subject = subject
    if (previewText !== undefined) updates.previewText = previewText
    if (content !== undefined) updates.content = content
    if (fromName !== undefined) updates.fromName = fromName
    if (fromEmail !== undefined) updates.fromEmail = fromEmail
    if (replyTo !== undefined) updates.replyTo = replyTo
    if (tags !== undefined) updates.tags = tags
    
    if (recipients !== undefined) {
      updates.recipients = recipients.map((r: string | { email: string; name?: string }) => {
        if (typeof r === 'string') {
          return { email: r.toLowerCase().trim() }
        }
        return {
          email: r.email.toLowerCase().trim(),
          name: r.name,
        }
      })
    }
    
    if (scheduledAt !== undefined) {
      updates.scheduledAt = scheduledAt ? new Date(scheduledAt) : null
      updates.status = scheduledAt ? 'scheduled' : 'draft'
    }

    const updatedCampaign = await Campaign.findByIdAndUpdate(
      id, 
      updates, 
      { new: true, runValidators: true }
    )

    logger.info(`Campaign updated: ${id}`)
    res.json({ success: true, campaign: updatedCampaign })
  } catch (error) {
    logger.error('Update campaign error:', error)
    res.status(500).json({ error: 'Failed to update campaign' })
  }
}

export const deleteCampaign = async (req: TenantRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }

    const { id } = req.params
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

    if (campaign.status === 'sending') {
      res.status(400).json({ error: 'Cannot delete a campaign that is currently sending' })
      return
    }

    await Campaign.findByIdAndDelete(id)

    logger.info(`Campaign deleted: ${id}`)
    res.json({ success: true, message: 'Campaign deleted successfully' })
  } catch (error) {
    logger.error('Delete campaign error:', error)
    res.status(500).json({ error: 'Failed to delete campaign' })
  }
}

export const sendCampaign = async (req: TenantRequest, res: Response): Promise<void> => {
  try {
    if (!req.user || !req.tenant) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }

    const { id } = req.params
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

    if (campaign.recipients.length === 0) {
      res.status(400).json({ error: 'Campaign has no recipients' })
      return
    }

    const tenant = await Tenant.findById(req.user.tenantId)
    if (!tenant?.canSendEmails(campaign.recipients.length)) {
      res.status(403).json({ 
        error: 'Insufficient email credits',
        needed: campaign.recipients.length,
        available: (tenant?.emailsLimit || 0) - (tenant?.emailsUsed || 0),
      })
      return
    }

    await Campaign.findByIdAndUpdate(id, { 
      status: 'queued',
      sentAt: new Date(),
    })

    await addBulkEmailsToQueue(
      campaign._id.toString(),
      req.user.tenantId,
      campaign.subject,
      campaign.content,
      campaign.recipients,
      {
        fromEmail: campaign.fromEmail,
        fromName: campaign.fromName,
        replyTo: campaign.replyTo,
      }
    )

    await Campaign.findByIdAndUpdate(id, { status: 'sending' })

    const updatedCampaign = await Campaign.findById(id).select('-recipients')

    logger.info(`Campaign sending started: ${id}, recipients: ${campaign.recipients.length}`)
    res.json({ 
      success: true, 
      campaign: updatedCampaign, 
      message: `Campaign queued for ${campaign.recipients.length} recipients`,
    })
  } catch (error) {
    logger.error('Send campaign error:', error)
    res.status(500).json({ error: 'Failed to send campaign' })
  }
}

export const pauseCampaign = async (req: TenantRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }

    const { id } = req.params
    
    const campaign = await Campaign.findOneAndUpdate(
      { _id: id, tenantId: req.user.tenantId, status: 'sending' },
      { status: 'paused' },
      { new: true }
    )

    if (!campaign) {
      res.status(404).json({ error: 'Campaign not found or not in sending state' })
      return
    }

    logger.info(`Campaign paused: ${id}`)
    res.json({ success: true, campaign })
  } catch (error) {
    logger.error('Pause campaign error:', error)
    res.status(500).json({ error: 'Failed to pause campaign' })
  }
}

export const duplicateCampaign = async (req: TenantRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }

    const { id } = req.params
    
    const original = await Campaign.findOne({
      _id: id,
      tenantId: req.user.tenantId,
    })

    if (!original) {
      res.status(404).json({ error: 'Campaign not found' })
      return
    }

    const duplicate = await Campaign.create({
      tenantId: original.tenantId,
      createdBy: req.user.id,
      name: `${original.name} (Copy)`,
      subject: original.subject,
      previewText: original.previewText,
      content: original.content,
      contentType: original.contentType,
      recipients: [],
      status: 'draft',
      fromName: original.fromName,
      fromEmail: original.fromEmail,
      replyTo: original.replyTo,
      tags: original.tags,
    })

    logger.info(`Campaign duplicated: ${id} -> ${duplicate._id}`)
    res.status(201).json({ success: true, campaign: duplicate })
  } catch (error) {
    logger.error('Duplicate campaign error:', error)
    res.status(500).json({ error: 'Failed to duplicate campaign' })
  }
}

export const getCampaignQueueStatus = async (req: TenantRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }

    const stats = await getQueueStats()
    res.json({ success: true, queue: stats })
  } catch (error) {
    logger.error('Get queue status error:', error)
    res.status(500).json({ error: 'Failed to get queue status' })
  }
}
