import { Request, Response, NextFunction } from 'express'
import { v4 as uuidv4 } from 'uuid'
import logger from '../utils/logger.js'

declare global {
  namespace Express {
    interface Request {
      requestId?: string
      startTime?: number
    }
  }
}

export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
  req.requestId = req.headers['x-request-id'] as string || uuidv4()
  req.startTime = Date.now()

  res.setHeader('X-Request-ID', req.requestId)

  res.on('finish', () => {
    const duration = Date.now() - (req.startTime || Date.now())
    const logData = {
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    }

    if (res.statusCode >= 400) {
      logger.warn('Request completed with error', logData)
    } else {
      logger.debug('Request completed', logData)
    }
  })

  next()
}
