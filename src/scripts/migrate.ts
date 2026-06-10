import mongoose from 'mongoose'
import dotenv from 'dotenv'
import User from '../models/User.js'
import Tenant from '../models/Tenant.js'
import Campaign from '../models/Campaign.js'
import EmailEvent from '../models/EmailEvent.js'

dotenv.config()

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/email-automation'

interface IndexDefinition {
  model: mongoose.Model<unknown>
  indexes: Array<{
    fields: Record<string, 1 | -1 | 'text'>
    options?: mongoose.IndexOptions
  }>
}

const indexDefinitions: IndexDefinition[] = [
  {
    model: User as mongoose.Model<unknown>,
    indexes: [
      { fields: { email: 1 }, options: { unique: true } },
      { fields: { tenantId: 1 } },
      { fields: { tenantId: 1, email: 1 } },
      { fields: { tenantId: 1, role: 1 } },
      { fields: { createdAt: -1 } },
      { fields: { isActive: 1, tenantId: 1 } },
    ],
  },
  {
    model: Tenant as mongoose.Model<unknown>,
    indexes: [
      { fields: { slug: 1 }, options: { unique: true } },
      { fields: { stripeCustomerId: 1 }, options: { sparse: true } },
      { fields: { stripeSubscriptionId: 1 }, options: { sparse: true } },
      { fields: { plan: 1 } },
      { fields: { isActive: 1 } },
      { fields: { currentPeriodEnd: 1 } },
    ],
  },
  {
    model: Campaign as mongoose.Model<unknown>,
    indexes: [
      { fields: { tenantId: 1 } },
      { fields: { tenantId: 1, status: 1 } },
      { fields: { tenantId: 1, createdAt: -1 } },
      { fields: { tenantId: 1, scheduledAt: 1 } },
      { fields: { status: 1, scheduledAt: 1 } },
      { fields: { tenantId: 1, tags: 1 } },
      { fields: { tenantId: 1, name: 'text', subject: 'text' } },
    ],
  },
  {
    model: EmailEvent as mongoose.Model<unknown>,
    indexes: [
      { fields: { tenantId: 1 } },
      { fields: { campaignId: 1 } },
      { fields: { tenantId: 1, campaignId: 1, type: 1 } },
      { fields: { tenantId: 1, createdAt: -1 } },
      { fields: { email: 1, campaignId: 1 } },
      { fields: { type: 1 } },
    ],
  },
]

async function createIndexes(): Promise<void> {
  console.log('🔧 Creating indexes...\n')

  for (const definition of indexDefinitions) {
    const modelName = definition.model.modelName
    console.log(`📦 Processing ${modelName}...`)

    try {
      await definition.model.collection.dropIndexes()
      console.log(`  ✓ Dropped existing indexes`)
    } catch {
      console.log(`  ℹ No existing indexes to drop`)
    }

    for (const index of definition.indexes) {
      try {
        await definition.model.collection.createIndex(index.fields, index.options || {})
        console.log(`  ✓ Created index: ${JSON.stringify(index.fields)}`)
      } catch (error) {
        console.error(`  ✗ Failed to create index: ${JSON.stringify(index.fields)}`, error)
      }
    }

    console.log('')
  }
}

async function listIndexes(): Promise<void> {
  console.log('\n📋 Current indexes:\n')

  for (const definition of indexDefinitions) {
    const modelName = definition.model.modelName
    console.log(`${modelName}:`)

    try {
      const indexes = await definition.model.collection.indexes()
      indexes.forEach((idx) => {
        console.log(`  - ${JSON.stringify(idx.key)}${idx.unique ? ' (unique)' : ''}${idx.sparse ? ' (sparse)' : ''}`)
      })
    } catch (error) {
      console.error(`  Error listing indexes:`, error)
    }

    console.log('')
  }
}

async function migrate(): Promise<void> {
  console.log('🚀 Starting database migration...\n')
  console.log(`📍 MongoDB URI: ${MONGODB_URI.replace(/\/\/.*@/, '//***@')}\n`)

  try {
    await mongoose.connect(MONGODB_URI)
    console.log('✅ Connected to MongoDB\n')

    await createIndexes()
    await listIndexes()

    console.log('✅ Migration completed successfully!')
  } catch (error) {
    console.error('❌ Migration failed:', error)
    process.exit(1)
  } finally {
    await mongoose.connection.close()
    console.log('\n👋 Database connection closed')
  }
}

async function rollback(): Promise<void> {
  console.log('🔄 Starting rollback...\n')

  try {
    await mongoose.connect(MONGODB_URI)
    console.log('✅ Connected to MongoDB\n')

    for (const definition of indexDefinitions) {
      const modelName = definition.model.modelName
      console.log(`📦 Dropping indexes for ${modelName}...`)

      try {
        await definition.model.collection.dropIndexes()
        console.log(`  ✓ Dropped all indexes (except _id)`)
      } catch (error) {
        console.error(`  ✗ Failed:`, error)
      }
    }

    console.log('\n✅ Rollback completed!')
  } catch (error) {
    console.error('❌ Rollback failed:', error)
    process.exit(1)
  } finally {
    await mongoose.connection.close()
  }
}

const command = process.argv[2]

switch (command) {
  case 'up':
  case 'migrate':
    migrate()
    break
  case 'down':
  case 'rollback':
    rollback()
    break
  case 'status':
    mongoose.connect(MONGODB_URI).then(() => listIndexes()).finally(() => mongoose.connection.close())
    break
  default:
    console.log('Usage: npx ts-node src/scripts/migrate.ts [up|down|status]')
    console.log('  up/migrate  - Create all indexes')
    console.log('  down/rollback - Drop all custom indexes')
    console.log('  status      - List current indexes')
    process.exit(0)
}
