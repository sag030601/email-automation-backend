import mongoose, { Document, Schema } from 'mongoose'
import type { ChunkSource } from '../rag/types.js'

export interface IKnowledgeChunk extends Document {
  tenantId: mongoose.Types.ObjectId
  source: ChunkSource
  sourceId?: string
  contactId?: string
  text: string
  embedding: number[]
  createdAt: Date
  updatedAt: Date
}

const knowledgeChunkSchema = new Schema<IKnowledgeChunk>(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    source: {
      type: String,
      enum: ['company', 'campaign', 'contact'],
      required: true,
    },
    sourceId: { type: String, trim: true },
    contactId: { type: String, trim: true, index: true },
    text: { type: String, required: true },
    embedding: { type: [Number], required: true },
  },
  { timestamps: true }
)

knowledgeChunkSchema.index({ tenantId: 1, source: 1, sourceId: 1 })

export default mongoose.model<IKnowledgeChunk>('KnowledgeChunk', knowledgeChunkSchema)
