import mongoose, { Document, Schema, Model } from 'mongoose'

export interface ICampaignRecipient {
  email: string
  name?: string
  variables?: Record<string, string>
}

export interface ICampaignStats {
  total: number
  sent: number
  delivered: number
  opened: number
  clicked: number
  bounced: number
  complained: number
  unsubscribed: number
  failed: number
  /** email.delivery_delayed from Resend */
  delayed: number
  /** email.suppressed from Resend */
  suppressed: number
}

export interface ICampaign extends Document {
  tenantId: mongoose.Types.ObjectId
  createdBy: mongoose.Types.ObjectId
  name: string
  subject: string
  previewText?: string
  content: string
  contentType: 'html' | 'text' | 'template'
  templateId?: string
  status: 'draft' | 'scheduled' | 'queued' | 'sending' | 'sent' | 'paused' | 'cancelled' | 'failed'
  recipients: ICampaignRecipient[]
  recipientCount: number
  tags: string[]
  scheduledAt?: Date
  sentAt?: Date
  completedAt?: Date
  fromName?: string
  fromEmail?: string
  replyTo?: string
  stats: ICampaignStats
  metadata: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
  getOpenRate(): number
  getClickRate(): number
  getBounceRate(): number
}

interface ICampaignModel extends Model<ICampaign> {
  findByTenant(tenantId: string, options?: { status?: string; limit?: number }): Promise<ICampaign[]>
  findScheduledCampaigns(): Promise<ICampaign[]>
}

const recipientSchema = new Schema({
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
  },
  name: {
    type: String,
    trim: true,
  },
  variables: {
    type: Map,
    of: String,
  },
}, { _id: false })

const statsSchema = new Schema({
  total: { type: Number, default: 0 },
  sent: { type: Number, default: 0 },
  delivered: { type: Number, default: 0 },
  opened: { type: Number, default: 0 },
  clicked: { type: Number, default: 0 },
  bounced: { type: Number, default: 0 },
  complained: { type: Number, default: 0 },
  unsubscribed: { type: Number, default: 0 },
  failed: { type: Number, default: 0 },
  delayed: { type: Number, default: 0 },
  suppressed: { type: Number, default: 0 },
}, { _id: false })

const campaignSchema = new Schema<ICampaign, ICampaignModel>(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: [true, 'Tenant ID is required'],
      index: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Creator ID is required'],
    },
    name: {
      type: String,
      required: [true, 'Campaign name is required'],
      trim: true,
      maxlength: [200, 'Name cannot exceed 200 characters'],
    },
    subject: {
      type: String,
      required: [true, 'Subject is required'],
      trim: true,
      maxlength: [998, 'Subject cannot exceed 998 characters'],
    },
    previewText: {
      type: String,
      trim: true,
      maxlength: [200, 'Preview text cannot exceed 200 characters'],
    },
    content: {
      type: String,
      required: [true, 'Content is required'],
    },
    contentType: {
      type: String,
      enum: ['html', 'text', 'template'],
      default: 'html',
    },
    templateId: {
      type: String,
    },
    status: {
      type: String,
      enum: {
        values: ['draft', 'scheduled', 'queued', 'sending', 'sent', 'paused', 'cancelled', 'failed'],
        message: 'Invalid status',
      },
      default: 'draft',
      index: true,
    },
    recipients: [recipientSchema],
    recipientCount: {
      type: Number,
      default: 0,
    },
    tags: [{
      type: String,
      trim: true,
      lowercase: true,
    }],
    scheduledAt: {
      type: Date,
      index: true,
    },
    sentAt: {
      type: Date,
    },
    completedAt: {
      type: Date,
    },
    fromName: {
      type: String,
      trim: true,
    },
    fromEmail: {
      type: String,
      trim: true,
      lowercase: true,
    },
    replyTo: {
      type: String,
      trim: true,
      lowercase: true,
    },
    stats: {
      type: statsSchema,
      default: () => ({}),
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
)

campaignSchema.index({ tenantId: 1, status: 1 })
campaignSchema.index({ tenantId: 1, createdAt: -1 })
campaignSchema.index({ tenantId: 1, scheduledAt: 1 })
campaignSchema.index({ status: 1, scheduledAt: 1 })
campaignSchema.index({ tenantId: 1, tags: 1 })
campaignSchema.index({ tenantId: 1, name: 'text', subject: 'text' })

campaignSchema.pre('save', function () {
  if (this.isModified('recipients')) {
    this.recipientCount = this.recipients.length
    this.stats.total = this.recipients.length
  }
})

campaignSchema.methods.getOpenRate = function (): number {
  if (this.stats.delivered === 0) return 0
  return (this.stats.opened / this.stats.delivered) * 100
}

campaignSchema.methods.getClickRate = function (): number {
  if (this.stats.delivered === 0) return 0
  return (this.stats.clicked / this.stats.delivered) * 100
}

campaignSchema.methods.getBounceRate = function (): number {
  if (this.stats.sent === 0) return 0
  return (this.stats.bounced / this.stats.sent) * 100
}

campaignSchema.statics.findByTenant = function (
  tenantId: string,
  options: { status?: string; limit?: number } = {}
): Promise<ICampaign[]> {
  const query: Record<string, unknown> = { tenantId }
  if (options.status) {
    query.status = options.status
  }
  return this.find(query)
    .sort({ createdAt: -1 })
    .limit(options.limit || 100)
    .exec()
}

campaignSchema.statics.findScheduledCampaigns = function (): Promise<ICampaign[]> {
  return this.find({
    status: 'scheduled',
    scheduledAt: { $lte: new Date() },
  }).exec()
}

export default mongoose.model<ICampaign, ICampaignModel>('Campaign', campaignSchema)
