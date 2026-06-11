import { Response } from 'express'
import Contact from '../models/Contact.js'
import { TenantRequest } from '../middleware/tenant.js'
import { isValidObjectId, parseRouteParam } from '../utils/validators.js'
import logger from '../utils/logger.js'

export const getContacts = async (req: TenantRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }

    const contacts = await Contact.find({ tenantId: req.user.tenantId }).sort({ name: 1 })
    res.json({ success: true, contacts })
  } catch (error) {
    logger.error('Get contacts error:', error)
    res.status(500).json({ error: 'Failed to fetch contacts' })
  }
}

export const createContact = async (req: TenantRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }

    const { name, email, notes } = req.body
    if (!name || !email) {
      res.status(400).json({ error: 'Name and email are required' })
      return
    }

    const contact = await Contact.create({
      tenantId: req.user.tenantId,
      name: String(name).trim(),
      email: String(email).toLowerCase().trim(),
      notes: notes ? String(notes).trim() : undefined,
    })

    res.status(201).json({ success: true, contact })
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      res.status(409).json({ error: 'Contact with this email already exists' })
      return
    }
    logger.error('Create contact error:', error)
    res.status(500).json({ error: 'Failed to create contact' })
  }
}

export const updateContact = async (req: TenantRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }

    const id = parseRouteParam(req.params.id)
    if (!isValidObjectId(id)) {
      res.status(400).json({ error: 'Invalid contact ID' })
      return
    }

    const { name, email, notes } = req.body
    const updates: Record<string, string> = {}
    if (name !== undefined) updates.name = String(name).trim()
    if (email !== undefined) updates.email = String(email).toLowerCase().trim()
    if (notes !== undefined) updates.notes = String(notes).trim()

    const contact = await Contact.findOneAndUpdate(
      { _id: id, tenantId: req.user.tenantId },
      updates,
      { new: true, runValidators: true }
    )

    if (!contact) {
      res.status(404).json({ error: 'Contact not found' })
      return
    }

    res.json({ success: true, contact })
  } catch (error) {
    logger.error('Update contact error:', error)
    res.status(500).json({ error: 'Failed to update contact' })
  }
}

export const deleteContact = async (req: TenantRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }

    const id = parseRouteParam(req.params.id)
    if (!isValidObjectId(id)) {
      res.status(400).json({ error: 'Invalid contact ID' })
      return
    }

    const contact = await Contact.findOneAndDelete({ _id: id, tenantId: req.user.tenantId })
    if (!contact) {
      res.status(404).json({ error: 'Contact not found' })
      return
    }

    res.json({ success: true, message: 'Contact deleted' })
  } catch (error) {
    logger.error('Delete contact error:', error)
    res.status(500).json({ error: 'Failed to delete contact' })
  }
}
