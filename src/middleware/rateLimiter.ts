import { rateLimit, Options } from 'express-rate-limit'
import { Request } from 'express'

export const createRateLimiter = (options: Partial<Options> = {}) => {
  return rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    message: { error: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => {
      return req.headers['x-forwarded-for'] as string || req.ip || 'unknown'
    },
    ...options,
  })
}

export const apiLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 100,
})

export const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many authentication attempts, please try again later.' },
})

export const emailSendLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 50,
  message: { error: 'Email sending limit reached, please try again later.' },
})

export const uploadLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many uploads, please try again later.' },
})
