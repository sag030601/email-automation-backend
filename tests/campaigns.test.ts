import request from 'supertest'
import mongoose from 'mongoose'
import app from '../src/app.js'
import User from '../src/models/User.js'
import Tenant from '../src/models/Tenant.js'
import Campaign from '../src/models/Campaign.js'

describe('Campaigns API', () => {
  let token: string
  let tenantId: string

  beforeAll(async () => {
    const mongoUri = process.env.MONGODB_URI_TEST || 'mongodb://localhost:27017/email-automation-test'
    await mongoose.connect(mongoUri)
  })

  afterAll(async () => {
    await mongoose.connection.dropDatabase()
    await mongoose.connection.close()
  })

  beforeEach(async () => {
    await User.deleteMany({})
    await Tenant.deleteMany({})
    await Campaign.deleteMany({})

    const res = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123',
      })
    token = res.body.token
    tenantId = res.body.tenantId
  })

  describe('GET /api/campaigns', () => {
    it('should return empty array when no campaigns', async () => {
      const res = await request(app)
        .get('/api/campaigns')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body.campaigns).toEqual([])
    })

    it('should return campaigns for tenant', async () => {
      await Campaign.create({
        tenantId,
        name: 'Test Campaign',
        subject: 'Test Subject',
        content: '<p>Test content</p>',
        recipients: ['user@example.com'],
      })

      const res = await request(app)
        .get('/api/campaigns')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body.campaigns).toHaveLength(1)
      expect(res.body.campaigns[0].name).toBe('Test Campaign')
    })
  })

  describe('POST /api/campaigns', () => {
    it('should create a campaign', async () => {
      const res = await request(app)
        .post('/api/campaigns')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'New Campaign',
          subject: 'Welcome!',
          content: '<p>Hello world</p>',
          recipients: ['user1@example.com', 'user2@example.com'],
        })

      expect(res.status).toBe(201)
      expect(res.body.campaign.name).toBe('New Campaign')
      expect(res.body.campaign.status).toBe('draft')
    })

    it('should reject missing required fields', async () => {
      const res = await request(app)
        .post('/api/campaigns')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'New Campaign',
        })

      expect(res.status).toBe(400)
    })

    it('should reject invalid email recipients', async () => {
      const res = await request(app)
        .post('/api/campaigns')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'New Campaign',
          subject: 'Welcome!',
          content: '<p>Hello world</p>',
          recipients: ['invalid-email'],
        })

      expect(res.status).toBe(400)
    })
  })

  describe('PUT /api/campaigns/:id', () => {
    let campaignId: string

    beforeEach(async () => {
      const campaign = await Campaign.create({
        tenantId,
        name: 'Test Campaign',
        subject: 'Test Subject',
        content: '<p>Test content</p>',
        recipients: ['user@example.com'],
      })
      campaignId = campaign._id.toString()
    })

    it('should update a draft campaign', async () => {
      const res = await request(app)
        .put(`/api/campaigns/${campaignId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Updated Campaign',
        })

      expect(res.status).toBe(200)
      expect(res.body.campaign.name).toBe('Updated Campaign')
    })

    it('should not update a sent campaign', async () => {
      await Campaign.findByIdAndUpdate(campaignId, { status: 'sent' })

      const res = await request(app)
        .put(`/api/campaigns/${campaignId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Updated Campaign',
        })

      expect(res.status).toBe(400)
    })
  })

  describe('DELETE /api/campaigns/:id', () => {
    it('should delete a campaign', async () => {
      const campaign = await Campaign.create({
        tenantId,
        name: 'Test Campaign',
        subject: 'Test Subject',
        content: '<p>Test content</p>',
        recipients: ['user@example.com'],
      })

      const res = await request(app)
        .delete(`/api/campaigns/${campaign._id}`)
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)

      const deleted = await Campaign.findById(campaign._id)
      expect(deleted).toBeNull()
    })
  })
})
