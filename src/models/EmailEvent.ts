import mongoose, { Document, Schema } from 'mongoose'

export interface IEmailEvent extends Document {
  tenantId: mongoose.Types.ObjectId
  campaignId: mongoose.Types.ObjectId
  email: string
  type:
    | 'sent'
    | 'delivered'
    | 'opened'
    | 'clicked'
    | 'bounced'
    | 'complained'
    | 'unsubscribed'
    | 'failed'
    | 'received'
    | 'delivery_delayed'
    | 'scheduled'
    | 'suppressed'
  metadata?: Record<string, unknown>
  createdAt: Date
}

const emailEventSchema = new Schema<IEmailEvent>(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    campaignId: {
      type: Schema.Types.ObjectId,
      ref: 'Campaign',
      required: true,
      index: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    type: {
      type: String,
      enum: [
        'sent',
        'delivered',
        'opened',
        'clicked',
        'bounced',
        'complained',
        'unsubscribed',
        'failed',
        'received',
        'delivery_delayed',
        'scheduled',
        'suppressed',
      ],
      required: true,
      index: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
)

emailEventSchema.index({ tenantId: 1, campaignId: 1, type: 1 })
emailEventSchema.index({ tenantId: 1, createdAt: -1 })

export default mongoose.model<IEmailEvent>('EmailEvent', emailEventSchema)
