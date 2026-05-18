import request from 'supertest'
import mongoose from 'mongoose'
import app from '../src/app.js'
import User from '../src/models/User.js'
import Tenant from '../src/models/Tenant.js'

describe('Auth API', () => {
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
  })

  describe('POST /api/auth/register', () => {
    it('should register a new user', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Test User',
          email: 'test@example.com',
          password: 'password123',
        })

      expect(res.status).toBe(201)
      expect(res.body).toHaveProperty('token')
      expect(res.body.user).toHaveProperty('email', 'test@example.com')
    })

    it('should reject duplicate email', async () => {
      await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Test User',
          email: 'test@example.com',
          password: 'password123',
        })

      const res = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Another User',
          email: 'test@example.com',
          password: 'password456',
        })

      expect(res.status).toBe(400)
      expect(res.body).toHaveProperty('error')
    })

    it('should reject invalid email', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Test User',
          email: 'invalid-email',
          password: 'password123',
        })

      expect(res.status).toBe(400)
    })

    it('should reject short password', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Test User',
          email: 'test@example.com',
          password: '123',
        })

      expect(res.status).toBe(400)
    })
  })

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Test User',
          email: 'test@example.com',
          password: 'password123',
        })
    })

    it('should login with valid credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'password123',
        })

      expect(res.status).toBe(200)
      expect(res.body).toHaveProperty('token')
    })

    it('should reject invalid password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'wrongpassword',
        })

      expect(res.status).toBe(401)
    })

    it('should reject non-existent user', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'password123',
        })

      expect(res.status).toBe(401)
    })
  })

  describe('GET /api/auth/me', () => {
    let token: string

    beforeEach(async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Test User',
          email: 'test@example.com',
          password: 'password123',
        })
      token = res.body.token
    })

    it('should return current user', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body.user).toHaveProperty('email', 'test@example.com')
    })

    it('should reject without token', async () => {
      const res = await request(app).get('/api/auth/me')

      expect(res.status).toBe(401)
    })

    it('should reject invalid token', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalid-token')

      expect(res.status).toBe(401)
    })
  })
})
