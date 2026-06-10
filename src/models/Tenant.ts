import mongoose, { Document, Schema, Model } from 'mongoose'

export interface ITenant extends Document {
  name: string
  slug: string
  plan: 'free' | 'basic' | 'pro' | 'enterprise'
  stripeCustomerId?: string
  stripeSubscriptionId?: string
  emailsUsed: number
  emailsLimit: number
  campaignsUsed: number
  campaignsLimit: number
  currentPeriodStart: Date
  currentPeriodEnd: Date
  isActive: boolean
  settings: {
    timezone: string
    defaultFromName: string
    defaultFromEmail?: string
    customDomain?: string
    webhookUrl?: string
  }
  createdAt: Date
  updatedAt: Date
  canSendEmails(count: number): boolean
  canCreateCampaign(): boolean
  incrementEmailsUsed(count: number): Promise<ITenant>
  resetMonthlyUsage(): Promise<ITenant>
}

interface ITenantModel extends Model<ITenant> {
  findBySlug(slug: string): Promise<ITenant | null>
  findByStripeCustomer(customerId: string): Promise<ITenant | null>
}

const planLimits: Record<string, { emails: number; campaigns: number }> = {
  // Free tier: enough campaigns for MVP / dev; still enforce paid plans for production scale
  free: { emails: 100, campaigns: 100 },
  basic: { emails: 10000, campaigns: 50 },
  pro: { emails: 50000, campaigns: -1 },
  enterprise: { emails: 200000, campaigns: -1 },
}

const tenantSchema = new Schema<ITenant, ITenantModel>(
  {
    name: {
      type: String,
      required: [true, 'Tenant name is required'],
      trim: true,
      maxlength: [100, 'Name cannot exceed 100 characters'],
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[a-z0-9-]+$/, 'Slug can only contain lowercase letters, numbers, and hyphens'],
    },
    plan: {
      type: String,
      enum: {
        values: ['free', 'basic', 'pro', 'enterprise'],
        message: 'Invalid plan type',
      },
      default: 'free',
    },
    stripeCustomerId: {
      type: String,
      index: { sparse: true },
    },
    stripeSubscriptionId: {
      type: String,
      index: { sparse: true },
    },
    emailsUsed: {
      type: Number,
      default: 0,
      min: [0, 'Emails used cannot be negative'],
    },
    emailsLimit: {
      type: Number,
      default: 100,
    },
    campaignsUsed: {
      type: Number,
      default: 0,
      min: [0, 'Campaigns used cannot be negative'],
    },
    campaignsLimit: {
      type: Number,
      default: 100,
    },
    currentPeriodStart: {
      type: Date,
      default: Date.now,
    },
    currentPeriodEnd: {
      type: Date,
      default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    settings: {
      timezone: {
        type: String,
        default: 'UTC',
      },
      defaultFromName: {
        type: String,
        default: '',
      },
      defaultFromEmail: {
        type: String,
      },
      customDomain: {
        type: String,
      },
      webhookUrl: {
        type: String,
      },
    },
  },
  {
    timestamps: true,
  }
)

tenantSchema.index({ plan: 1 })
tenantSchema.index({ isActive: 1 })
tenantSchema.index({ currentPeriodEnd: 1 })

tenantSchema.pre('save', function () {
  if (this.isModified('plan')) {
    const limits = planLimits[this.plan]
    this.emailsLimit = limits.emails
    this.campaignsLimit = limits.campaigns
  }
  
  if (!this.slug && this.name) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      + '-' + Date.now().toString(36)
  }
})

tenantSchema.methods.canSendEmails = function (count: number): boolean {
  return this.isActive && (this.emailsUsed + count) <= this.emailsLimit
}

tenantSchema.methods.canCreateCampaign = function (): boolean {
  if (!this.isActive) return false
  if (this.campaignsLimit === -1) return true
  return this.campaignsUsed < this.campaignsLimit
}

tenantSchema.methods.incrementEmailsUsed = async function (count: number): Promise<ITenant> {
  this.emailsUsed += count
  return this.save()
}

tenantSchema.methods.resetMonthlyUsage = async function (): Promise<ITenant> {
  this.emailsUsed = 0
  this.campaignsUsed = 0
  this.currentPeriodStart = new Date()
  this.currentPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  return this.save()
}

tenantSchema.statics.findBySlug = function (slug: string): Promise<ITenant | null> {
  return this.findOne({ slug, isActive: true })
}

tenantSchema.statics.findByStripeCustomer = function (customerId: string): Promise<ITenant | null> {
  return this.findOne({ stripeCustomerId: customerId })
}

export default mongoose.model<ITenant, ITenantModel>('Tenant', tenantSchema)
