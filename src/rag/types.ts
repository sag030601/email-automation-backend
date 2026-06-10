export type ChunkSource = 'company' | 'campaign' | 'contact'

export interface RawChunk {
  source: ChunkSource
  sourceId?: string
  contactId?: string
  text: string
}

export interface RetrievedChunk {
  source: ChunkSource
  sourceId?: string
  text: string
  score: number
}
