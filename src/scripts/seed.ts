import mongoose from 'mongoose'
import dotenv from 'dotenv'
import bcrypt from 'bcryptjs'
import User from '../models/User.js'
import Tenant from '../models/Tenant.js'
import Campaign from '../models/Campaign.js'

dotenv.config()

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/email-automation'

async function seed(): Promise<void> {
  console.log('🌱 Starting database seeding...\n')

  try {
    await mongoose.connect(MONGODB_URI)
    console.log('✅ Connected to MongoDB\n')

    const existingTenant = await Tenant.findOne({ slug: 'demo-company' })
    if (existingTenant) {
      console.log('⚠️  Demo data already exists. Skipping seed.')
      return
    }

    console.log('📦 Creating demo tenant...')
    const tenant = await Tenant.create({
      name: 'Demo Company',
      slug: 'demo-company',
      plan: 'pro',
      emailsLimit: 50000,
      campaignsLimit: -1,
      settings: {
        timezone: 'America/New_York',
        defaultFromName: 'Demo Company',
      },
    })
    console.log(`  ✓ Created tenant: ${tenant.name}`)

    console.log('\n📦 Creating demo user...')
    const hashedPassword = await bcrypt.hash('demo123456', 12)
    const user = await User.create({
      email: 'demo@example.com',
      password: hashedPassword,
      name: 'Demo User',
      tenantId: tenant._id,
      role: 'admin',
      isActive: true,
      emailVerified: true,
    })
    console.log(`  ✓ Created user: ${user.email}`)

    console.log('\n📦 Creating demo campaigns...')
    const campaigns = [
      {
        tenantId: tenant._id,
        createdBy: user._id,
        name: 'Welcome Series - Day 1',
        subject: 'Welcome to Demo Company!',
        content: '<h1>Welcome!</h1><p>Thanks for signing up.</p>',
        status: 'sent',
        recipients: [
          { email: 'subscriber1@example.com', name: 'John Doe' },
          { email: 'subscriber2@example.com', name: 'Jane Smith' },
        ],
        sentAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        stats: {
          total: 2,
          sent: 2,
          delivered: 2,
          opened: 1,
          clicked: 1,
          bounced: 0,
          complained: 0,
          unsubscribed: 0,
          failed: 0,
        },
        tags: ['welcome', 'onboarding'],
      },
      {
        tenantId: tenant._id,
        createdBy: user._id,
        name: 'Product Launch Announcement',
        subject: 'Introducing Our New Feature!',
        content: '<h1>New Feature Alert</h1><p>Check out our latest release.</p>',
        status: 'draft',
        recipients: [],
        tags: ['announcement', 'product'],
      },
      {
        tenantId: tenant._id,
        createdBy: user._id,
        name: 'Monthly Newsletter - June',
        subject: 'Your June Newsletter',
        content: '<h1>June Updates</h1><p>Here is what happened this month.</p>',
        status: 'scheduled',
        recipients: [
          { email: 'subscriber1@example.com' },
          { email: 'subscriber3@example.com' },
          { email: 'subscriber4@example.com' },
        ],
        scheduledAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
        tags: ['newsletter', 'monthly'],
      },
    ]

    for (const campaignData of campaigns) {
      const campaign = await Campaign.create(campaignData)
      console.log(`  ✓ Created campaign: ${campaign.name}`)
    }

    console.log('\n✅ Seeding completed successfully!')
    console.log('\n📋 Demo credentials:')
    console.log('  Email: demo@example.com')
    console.log('  Password: demo123456')
  } catch (error) {
    console.error('❌ Seeding failed:', error)
    process.exit(1)
  } finally {
    await mongoose.connection.close()
    console.log('\n👋 Database connection closed')
  }
}

async function reset(): Promise<void> {
  console.log('🗑️  Resetting database...\n')

  try {
    await mongoose.connect(MONGODB_URI)
    console.log('✅ Connected to MongoDB\n')

    const collections = ['users', 'tenants', 'campaigns', 'emailevents']
    for (const collection of collections) {
      try {
        await mongoose.connection.collection(collection).drop()
        console.log(`  ✓ Dropped collection: ${collection}`)
      } catch {
        console.log(`  ℹ Collection ${collection} does not exist`)
      }
    }

    console.log('\n✅ Database reset completed!')
  } catch (error) {
    console.error('❌ Reset failed:', error)
    process.exit(1)
  } finally {
    await mongoose.connection.close()
  }
}

const command = process.argv[2]

switch (command) {
  case 'seed':
    seed()
    break
  case 'reset':
    reset()
    break
  case 'fresh':
    reset().then(() => seed())
    break
  default:
    console.log('Usage: npx ts-node src/scripts/seed.ts [seed|reset|fresh]')
    console.log('  seed  - Add demo data')
    console.log('  reset - Drop all collections')
    console.log('  fresh - Reset and seed')
    process.exit(0)
}
