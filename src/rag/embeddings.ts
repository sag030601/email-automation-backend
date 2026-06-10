import {
  NOMIC_API_BASE,
  NOMIC_EMBED_MODEL,
  type NomicTaskType,
  getNomicHeaders,
} from '../config/nomic.js'
import logger from '../utils/logger.js'

export async function embedText(
  text: string,
  taskType: NomicTaskType = 'search_document'
): Promise<number[]> {
  const response = await fetch(`${NOMIC_API_BASE}/embedding/text`, {
    method: 'POST',
    headers: getNomicHeaders(),
    body: JSON.stringify({
      model: NOMIC_EMBED_MODEL,
      texts: [text.trim()],
      task_type: taskType,
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    logger.error('Nomic embed error:', { status: response.status, body })
    throw new Error(
      `Embedding failed (${response.status}). Check NOMIC_API_KEY and model ${NOMIC_EMBED_MODEL}.`
    )
  }

  const data = (await response.json()) as {
    embeddings?: number[][]
  }
  const embedding = data.embeddings?.[0]
  if (!embedding?.length) {
    throw new Error('Empty embedding from Nomic')
  }
  return embedding
}
