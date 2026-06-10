import mongoose from 'mongoose'
import dotenv from 'dotenv'
import Tenant from '../models/Tenant.js'

dotenv.config()

const resetLimits = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI!)
    console.log('Connected to MongoDB')

    // Update all tenants to have unlimited campaigns for testing
    const result = await Tenant.updateMany(
      {},
      {
        $set: {
          campaignsUsed: 0,
          campaignsLimit: -1, // -1 means unlimited
          emailsUsed: 0,
          emailsLimit: 10000,
        },
      }
    )

    console.log(`Updated ${result.modifiedCount} tenant(s)`)
    console.log('All tenants now have unlimited campaigns and 10,000 email limit')

    await mongoose.disconnect()
    process.exit(0)
  } catch (error) {
    console.error('Error:', error)
    process.exit(1)
  }
}

resetLimits()
