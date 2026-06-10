import mongoose, { Document, Schema } from 'mongoose'

export interface IContact extends Document {
  tenantId: mongoose.Types.ObjectId
  name: string
  email: string
  notes?: string
  createdAt: Date
  updatedAt: Date
}

const contactSchema = new Schema<IContact>(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      maxlength: 200,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email'],
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 2000,
    },
  },
  { timestamps: true }
)

contactSchema.index({ tenantId: 1, email: 1 }, { unique: true })

export default mongoose.model<IContact>('Contact', contactSchema)
