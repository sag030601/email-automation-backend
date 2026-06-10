export const GROQ_API_BASE = 'https://api.groq.com/openai/v1'
export const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'

export function getGroqApiKey(): string {
  const apiKey = process.env.GROQ_API_KEY?.trim()
  if (!apiKey) {
    throw new Error('GROQ_API_KEY is not configured. Add it to your environment variables.')
  }
  return apiKey
}

export function getGroqHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${getGroqApiKey()}`,
  }
}
