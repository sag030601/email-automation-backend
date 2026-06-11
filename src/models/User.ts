import mongoose, { Document, Schema, Model } from 'mongoose'
import bcrypt from 'bcryptjs'

export interface IUser extends Document {
  email: string
  password: string
  name: string
  tenantId: mongoose.Types.ObjectId
  role: 'admin' | 'user'
  isActive: boolean
  lastLoginAt?: Date
  passwordResetToken?: string
  passwordResetExpires?: Date
  emailVerified: boolean
  emailVerificationToken?: string
  createdAt: Date
  updatedAt: Date
  comparePassword(candidatePassword: string): Promise<boolean>
  toSafeObject(): Partial<IUser>
}

interface IUserModel extends Model<IUser> {
  findByEmail(email: string): Promise<IUser | null>
  findByTenant(tenantId: string): Promise<IUser[]>
}

const userSchema = new Schema<IUser, IUserModel>(
  {
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email'],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [6, 'Password must be at least 6 characters'],
      select: false,
    },
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      maxlength: [100, 'Name cannot exceed 100 characters'],
    },
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: [true, 'Tenant ID is required'],
      index: true,
    },
    role: {
      type: String,
      enum: {
        values: ['admin', 'user'],
        message: 'Role must be admin or user',
      },
      default: 'admin',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastLoginAt: {
      type: Date,
    },
    passwordResetToken: {
      type: String,
      select: false,
    },
    passwordResetExpires: {
      type: Date,
      select: false,
    },
    emailVerified: {
      type: Boolean,
      default: false,
    },
    emailVerificationToken: {
      type: String,
      select: false,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret: Record<string, unknown>) => {
        delete ret.password
        delete ret.passwordResetToken
        delete ret.passwordResetExpires
        delete ret.emailVerificationToken
        delete ret.__v
        return ret
      },
    },
  }
)

userSchema.index({ tenantId: 1, email: 1 })
userSchema.index({ tenantId: 1, role: 1 })
userSchema.index({ createdAt: -1 })
userSchema.index({ isActive: 1, tenantId: 1 })

userSchema.pre('save', async function () {
  if (!this.isModified('password')) return
  this.password = await bcrypt.hash(this.password, 12)
})

userSchema.methods.comparePassword = async function (candidatePassword: string): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password)
}

userSchema.methods.toSafeObject = function (): Partial<IUser> {
  const obj = this.toObject()
  delete obj.password
  delete obj.passwordResetToken
  delete obj.passwordResetExpires
  delete obj.emailVerificationToken
  return obj
}

userSchema.statics.findByEmail = function (email: string): Promise<IUser | null> {
  return this.findOne({ email: email.toLowerCase() }).select('+password')
}

userSchema.statics.findByTenant = function (tenantId: string): Promise<IUser[]> {
  return this.find({ tenantId, isActive: true })
}

export default mongoose.model<IUser, IUserModel>('User', userSchema)
