export const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

export const isValidObjectId = (id: string): boolean => {
  const objectIdRegex = /^[0-9a-fA-F]{24}$/
  return objectIdRegex.test(id)
}

export const sanitizeEmail = (email: string): string => {
  return email.toLowerCase().trim()
}

export const validatePassword = (password: string): { valid: boolean; message?: string } => {
  if (password.length < 6) {
    return { valid: false, message: 'Password must be at least 6 characters long' }
  }
  return { valid: true }
}

export const validateCampaignData = (data: {
  name?: string
  subject?: string
  content?: string
  recipients?: string[]
}): { valid: boolean; errors: string[] } => {
  const errors: string[] = []

  if (!data.name || data.name.trim().length === 0) {
    errors.push('Campaign name is required')
  }
  if (!data.subject || data.subject.trim().length === 0) {
    errors.push('Email subject is required')
  }
  if (!data.content || data.content.trim().length === 0) {
    errors.push('Email content is required')
  }
  if (!data.recipients || data.recipients.length === 0) {
    errors.push('At least one recipient is required')
  } else {
    const invalidEmails = data.recipients.filter((email) => !isValidEmail(email))
    if (invalidEmails.length > 0) {
      errors.push(`Invalid email addresses: ${invalidEmails.join(', ')}`)
    }
  }

  return { valid: errors.length === 0, errors }
}
