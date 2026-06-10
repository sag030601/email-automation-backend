import KnowledgeChunk from '../models/KnowledgeChunk.js'
import { isRagEnabled } from '../config/nomic.js'
import { collectChunks } from './chunkSources.js'
import { embedText } from './embeddings.js'
import logger from '../utils/logger.js'

export async function indexTenantKnowledge(tenantId: string): Promise<number> {
  if (!isRagEnabled()) {
    logger.info('RAG indexing skipped (NOMIC_API_KEY not set). Emails still generate via Groq.')
    return 0
  }

  const raw = await collectChunks(tenantId)
  if (raw.length === 0) {
    await KnowledgeChunk.deleteMany({ tenantId })
    return 0
  }

  const docs = []
  for (const chunk of raw) {
    try {
      const embedding = await embedText(chunk.text)
      docs.push({
        tenantId,
        source: chunk.source,
        sourceId: chunk.sourceId,
        contactId: chunk.contactId,
        text: chunk.text,
        embedding,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'embed failed'
      logger.warn(`Skip chunk embed (${chunk.source}): ${message}`)
    }
  }

  if (docs.length === 0) {
    logger.warn(`RAG indexing produced 0 embeddings for tenant ${tenantId}`)
    return 0
  }

  await KnowledgeChunk.deleteMany({ tenantId })
  await KnowledgeChunk.insertMany(docs)

  logger.info(`RAG indexed ${docs.length} chunks for tenant ${tenantId}`)
  return docs.length
}
