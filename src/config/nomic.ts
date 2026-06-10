export const NOMIC_API_BASE = 'https://api-atlas.nomic.ai/v1'
export const NOMIC_EMBED_MODEL =
  process.env.NOMIC_EMBED_MODEL || 'nomic-embed-text-v1.5'

export type NomicTaskType =
  | 'search_document'
  | 'search_query'
  | 'classification'
  | 'clustering'

export function isRagEnabled(): boolean {
  return Boolean(process.env.NOMIC_API_KEY?.trim())
}

export function getNomicApiKey(): string {
  const apiKey = process.env.NOMIC_API_KEY?.trim()
  if (!apiKey) {
    throw new Error(
      'NOMIC_API_KEY is not configured. Get a free key at https://atlas.nomic.ai/'
    )
  }
  return apiKey
}

export function getNomicHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${getNomicApiKey()}`,
  }
}
