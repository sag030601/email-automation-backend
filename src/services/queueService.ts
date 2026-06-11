import { Queue, Worker, Job, QueueEvents } from 'bullmq'
import Campaign from '../models/Campaign.js'
import Tenant from '../models/Tenant.js'
import EmailEvent from '../models/EmailEvent.js'
import { sendEmail } from './emailService.js'
import logger from '../utils/logger.js'
import { getRedisConfig, isRedisEnabled } from '../config/redis.js'

let emailQueue: Queue | null = null
let emailWorker: Worker | null = null
let queueEvents: QueueEvents | null = null

export interface EmailJobData {
  campaignId: string
  tenantId: string
  to: string
  name?: string
  subject: string
  html: string
  fromEmail?: string
  fromName?: string
  replyTo?: string
  variables?: Record<string, string>
}

export interface CampaignJobData {
  campaignId: string
  tenantId: string
}

export const getEmailQueue = (): Queue | null => {
  if (!isRedisEnabled()) {
    return null
  }
  if (!emailQueue) {
    try {
      emailQueue = new Queue('email-queue', {
        connection: getRedisConfig(),
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
          removeOnComplete: {
            age: 24 * 60 * 60,
            count: 1000,
          },
          removeOnFail: {
            age: 7 * 24 * 60 * 60,
            count: 5000,
          },
        },
      })
    } catch {
      return null
    }
  }
  return emailQueue
}

export const addEmailToQueue = async (data: EmailJobData): Promise<Job<EmailJobData> | null> => {
  const queue = getEmailQueue()
  if (!queue) {
    logger.warn('Queue not available, email not queued')
    return null
  }
  return queue.add('send-email', data, {
    priority: 1,
  })
}

export const addBulkEmailsToQueue = async (
  campaignId: string,
  tenantId: string,
  subject: string,
  html: string,
  recipients: Array<{
    email: string
    name?: string
    subject?: string
    html?: string
    variables?: Record<string, string>
  }>,
  options?: { fromEmail?: string; fromName?: string; replyTo?: string }
): Promise<void> => {
  const queue = getEmailQueue()
  if (!queue) {
    logger.warn('Queue not available, bulk emails not queued')
    return
  }
  
  const jobs = recipients.map((recipient, index) => ({
    name: 'send-email',
    data: {
      campaignId,
      tenantId,
      to: recipient.email,
      name: recipient.name,
      subject: recipient.subject || subject,
      html: recipient.html || html,
      fromEmail: options?.fromEmail,
      fromName: options?.fromName,
      replyTo: options?.replyTo,
      variables: recipient.variables,
    },
    opts: {
      priority: 1,
      delay: index * 100,
    },
  }))

  const batchSize = 100
  for (let i = 0; i < jobs.length; i += batchSize) {
    const batch = jobs.slice(i, i + batchSize)
    await queue.addBulk(batch)
    logger.info(`Added batch ${i / batchSize + 1} to queue (${batch.length} emails)`)
  }
}

const processEmailJob = async (job: Job<EmailJobData>) => {
  const { campaignId, tenantId, to, name, subject, html, fromEmail, fromName, replyTo, variables } = job.data

  let processedHtml = html
  if (variables) {
    Object.entries(variables).forEach(([key, value]) => {
      processedHtml = processedHtml.replace(new RegExp(`{{${key}}}`, 'g'), value)
    })
  }
  if (name) {
    processedHtml = processedHtml.replace(/{{name}}/g, name)
  }

  const result = await sendEmail({
    to,
    subject,
    html: processedHtml,
    from: fromEmail && fromName ? `${fromName} <${fromEmail}>` : undefined,
    replyTo,
    tags: [
      { name: 'campaign_id', value: String(campaignId) },
      { name: 'tenant_id', value: String(tenantId) },
    ],
  })

  if (result.success) {
    await EmailEvent.create({
      tenantId,
      campaignId,
      email: to,
      type: 'sent',
      metadata: { resendId: result.id, jobId: job.id },
    })

    await Tenant.findByIdAndUpdate(tenantId, { $inc: { emailsUsed: 1 } })
    const campaign = await Campaign.findByIdAndUpdate(
      campaignId, 
      { $inc: { 'stats.sent': 1 } },
      { new: true }
    )

    // Check if all emails are sent and update status
    if (campaign) {
      const totalRecipients = campaign.recipients?.length || 0
      const totalProcessed = (campaign.stats?.sent || 0) + (campaign.stats?.failed || 0)
      
      if (totalProcessed >= totalRecipients && campaign.status === 'sending') {
        await Campaign.findByIdAndUpdate(campaignId, { status: 'sent' })
        logger.info(`Campaign ${campaignId} completed: ${campaign.stats?.sent} sent, ${campaign.stats?.failed} failed`)
      }
    }

    logger.debug(`Email sent to ${to} for campaign ${campaignId}`)
  } else {
    const campaign = await Campaign.findByIdAndUpdate(
      campaignId, 
      { $inc: { 'stats.failed': 1 } },
      { new: true }
    )
    
    // Check if all emails are processed
    if (campaign) {
      const totalRecipients = campaign.recipients?.length || 0
      const totalProcessed = (campaign.stats?.sent || 0) + (campaign.stats?.failed || 0)
      
      if (totalProcessed >= totalRecipients && campaign.status === 'sending') {
        const newStatus = (campaign.stats?.sent || 0) > 0 ? 'sent' : 'failed'
        await Campaign.findByIdAndUpdate(campaignId, { status: newStatus })
        logger.info(`Campaign ${campaignId} completed with status ${newStatus}`)
      }
    }
    
    logger.error(`Failed to send email to ${to}: ${result.error}`)
    throw new Error(result.error)
  }

  return result
}

export const startEmailWorker = (): Worker | null => {
  if (!isRedisEnabled()) {
    logger.info('Queue worker not started - Redis not available')
    return null
  }
  
  if (emailWorker) {
    return emailWorker
  }

  try {
    const redisConfig = getRedisConfig()

    emailWorker = new Worker<EmailJobData>(
    'email-queue',
    processEmailJob,
    {
      connection: redisConfig,
      concurrency: parseInt(process.env.EMAIL_WORKER_CONCURRENCY || '5'),
    }
  )

  emailWorker.on('completed', (job) => {
    logger.debug(`Job ${job.id} completed for ${job.data.to}`)
  })

  emailWorker.on('failed', (job, err) => {
    logger.error(`Job ${job?.id} failed for ${job?.data.to}:`, err.message)
  })

  emailWorker.on('error', (err) => {
    logger.error('Worker error:', err)
  })
  
  queueEvents = new QueueEvents('email-queue', { connection: redisConfig })
  
  queueEvents.on('completed', ({ jobId }) => {
    logger.debug(`Queue event: Job ${jobId} completed`)
  })

  queueEvents.on('failed', ({ jobId, failedReason }) => {
    logger.error(`Queue event: Job ${jobId} failed - ${failedReason}`)
  })

  logger.info('Email worker started')
  return emailWorker
  } catch (error) {
    logger.warn('Failed to start email worker (Redis may not be available):', error)
    return null
  }
}

export const stopEmailWorker = async (): Promise<void> => {
  if (emailWorker) {
    await emailWorker.close()
    emailWorker = null
  }
  if (queueEvents) {
    await queueEvents.close()
    queueEvents = null
  }
  if (emailQueue) {
    await emailQueue.close()
    emailQueue = null
  }
  logger.info('Email worker stopped')
}

export const getQueueStats = async () => {
  const queue = getEmailQueue()
  if (!queue) {
    return { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, available: false }
  }
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ])

  return { waiting, active, completed, failed, delayed, available: true }
}

export const pauseQueue = async (): Promise<void> => {
  const queue = getEmailQueue()
  if (!queue) return
  await queue.pause()
  logger.info('Email queue paused')
}

export const resumeQueue = async (): Promise<void> => {
  const queue = getEmailQueue()
  if (!queue) return
  await queue.resume()
  logger.info('Email queue resumed')
}

export const drainQueue = async (): Promise<void> => {
  const queue = getEmailQueue()
  if (!queue) return
  await queue.drain()
  logger.info('Email queue drained')
}

export const retryFailedJobs = async (): Promise<number> => {
  const queue = getEmailQueue()
  if (!queue) return 0
  const failed = await queue.getFailed()
  
  let retried = 0
  for (const job of failed) {
    await job.retry()
    retried++
  }
  
  logger.info(`Retried ${retried} failed jobs`)
  return retried
}

export { emailWorker, emailQueue }
