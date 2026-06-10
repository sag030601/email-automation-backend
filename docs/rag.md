# RAG for AI campaigns

Minimal retrieval-augmented generation for personalized emails.

## Flow

1. **Index** (`rag/indexer`) — collect text chunks → embed with Nomic → store in MongoDB
2. **Retrieve** (`rag/retriever`) — embed query (goal + tone + contact) → cosine top-3
3. **Generate** (`groqService`) — pass chunks + contact + campaign to Groq chat model

## Chunk sources

| Source    | Content |
|-----------|---------|
| `company` | Tenant name, sender settings, plan |
| `campaign`| Past campaigns: goal, tone, subject, stats |
| `contact` | Contact profile, notes, past emails, email events |

## Modules

```
backend/src/rag/
  types.ts          — RawChunk, RetrievedChunk
  chunkSources.ts   — build text from MongoDB (no embeddings)
  embeddings.ts     — Nomic nomic-embed-text-v1.5
  similarity.ts     — cosine similarity
  indexer.ts        — embed + KnowledgeChunk collection
  retriever.ts      — query embed + top-K search
  index.ts          — public exports
```

## Setup

Email generation works with **Groq only**. RAG context is optional — add a Nomic key to enable personalized retrieval (Groq does not host embedding models).

```env
GROQ_API_KEY=gsk_your_groq_api_key
GROQ_MODEL=llama-3.3-70b-versatile
NOMIC_API_KEY=your_nomic_api_key
NOMIC_EMBED_MODEL=nomic-embed-text-v1.5
RAG_TOP_K=3
```

## When it runs

- `POST /api/campaigns/ai/generate` re-indexes tenant knowledge, then per contact: retrieve → generate.
- After campaign save, knowledge is re-indexed in the background (includes new campaign).

## Vector store

`KnowledgeChunk` in MongoDB: `tenantId`, `source`, `text`, `embedding[]`. Search loads tenant chunks and ranks in memory (fine for hundreds of chunks).





vercel setup------------
https://resend.com/docs/knowledge-base/vercel