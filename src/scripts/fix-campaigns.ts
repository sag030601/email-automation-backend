import mongoose from 'mongoose'
import dotenv from 'dotenv'
import Campaign from '../models/Campaign.js'

dotenv.config()

const fixCampaigns = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI!)
    console.log('Connected to MongoDB')

    // Find all campaigns stuck in "sending" status
    const stuckCampaigns = await Campaign.find({ status: 'sending' })
    console.log(`Found ${stuckCampaigns.length} campaigns in 'sending' status`)

    for (const campaign of stuckCampaigns) {
      const totalRecipients = campaign.recipients?.length || 0
      const totalSent = campaign.stats?.sent || 0
      const totalFailed = campaign.stats?.failed || 0
      const totalProcessed = totalSent + totalFailed

      console.log(`Campaign ${campaign._id} (${campaign.name}):`)
      console.log(`  - Recipients: ${totalRecipients}`)
      console.log(`  - Sent: ${totalSent}`)
      console.log(`  - Failed: ${totalFailed}`)

      if (totalProcessed >= totalRecipients) {
        const newStatus = totalSent > 0 ? 'sent' : 'failed'
        await Campaign.findByIdAndUpdate(campaign._id, { status: newStatus })
        console.log(`  -> Updated status to: ${newStatus}`)
      } else {
        console.log(`  -> Still processing (${totalProcessed}/${totalRecipients})`)
      }
    }

    console.log('\nDone!')
    await mongoose.disconnect()
    process.exit(0)
  } catch (error) {
    console.error('Error:', error)
    process.exit(1)
  }
}

fixCampaigns()
