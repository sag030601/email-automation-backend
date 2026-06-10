import { GROQ_API_BASE, GROQ_MODEL, getGroqHeaders } from '../config/groq.js'
import logger from '../utils/logger.js'
import type { RetrievedChunk } from '../rag/types.js'

export interface ContactContext {
  name: string
  email: string
  notes?: string
}

export interface GeneratedEmail {
  subject: string
  body: string
}

function formatContext(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return ''
  const lines = chunks.map((c, i) => `[${i + 1}] (${c.source}) ${c.text}`)
  return `\nRelevant context from company, campaigns, and contact history:\n${lines.join('\n')}\nUse this context for continuity and personalization where appropriate.\n`
}

function buildPrompt(
  goal: string,
  tone: string,
  contact: ContactContext,
  contextChunks: RetrievedChunk[] = []
): string {
  const notesLine = contact.notes ? `Notes about recipient: ${contact.notes}` : ''
  const contextBlock = formatContext(contextChunks)
  return `Write a personalized outreach email.

Campaign goal: ${goal}
Tone: ${tone}
Recipient name: ${contact.name}
Recipient email: ${contact.email}
${notesLine}
${contextBlock}
Respond with ONLY valid JSON in this exact shape (no markdown, no extra text):
{"subject":"...","body":"..."}

The body should be plain text suitable for email (2-4 short paragraphs). Do not include placeholders like [Name] — use the actual recipient name.`
}

function parseGeneratedResponse(raw: string): GeneratedEmail {
  const trimmed = raw.trim()
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error('Groq response did not contain JSON')
  }
  const parsed = JSON.parse(jsonMatch[0]) as { subject?: string; body?: string }
  if (!parsed.subject || !parsed.body) {
    throw new Error('Groq response missing subject or body')
  }
  return { subject: parsed.subject.trim(), body: parsed.body.trim() }
}

export async function generatePersonalizedEmail(
  goal: string,
  tone: string,
  contact: ContactContext,
  contextChunks: RetrievedChunk[] = []
): Promise<GeneratedEmail> {
  const prompt = buildPrompt(goal, tone, contact, contextChunks)

  const response = await fetch(`${GROQ_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: getGroqHeaders(),
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        {
          role: 'system',
          content:
            'You are an expert B2B email copywriter. Always respond with valid JSON only.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
      response_format: { type: 'json_object' },
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    logger.error('Groq API error:', { status: response.status, text })
    throw new Error(
      `Groq request failed (${response.status}). Check GROQ_API_KEY and model availability.`
    )
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = data.choices?.[0]?.message?.content
  if (!content) {
    throw new Error('Empty response from Groq')
  }

  return parseGeneratedResponse(content)
}
