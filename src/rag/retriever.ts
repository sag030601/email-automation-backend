import KnowledgeChunk from '../models/KnowledgeChunk.js'
import { isRagEnabled } from '../config/nomic.js'
import { embedText } from './embeddings.js'
import { cosineSimilarity } from './similarity.js'
import type { RetrievedChunk } from './types.js'

const TOP_K = Number(process.env.RAG_TOP_K || 3)

export function buildRetrievalQuery(
  goal: string,
  tone: string,
  contact: { name: string; email: string; notes?: string }
): string {
  return [
    `Campaign goal: ${goal}`,
    `Tone: ${tone}`,
    `Contact: ${contact.name}`,
    `Email: ${contact.email}`,
    contact.notes ? `Contact notes: ${contact.notes}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

export async function retrieveRelevantChunks(
  tenantId: string,
  query: string,
  topK = TOP_K
): Promise<RetrievedChunk[]> {
  if (!isRagEnabled()) return []

  const chunks = await KnowledgeChunk.find({ tenantId }).lean()
  if (chunks.length === 0) return []

  const queryEmbedding = await embedText(query, 'search_query')
  const scored = chunks
    .map((c) => ({
      source: c.source,
      sourceId: c.sourceId,
      text: c.text,
      score: cosineSimilarity(queryEmbedding, c.embedding),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)

  return scored
}
