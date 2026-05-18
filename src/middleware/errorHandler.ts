import { Request, Response, NextFunction } from 'express'
import logger from '../utils/logger.js'

export class AppError extends Error {
  statusCode: number
  isOperational: boolean

  constructor(message: string, statusCode: number) {
    super(message)
    this.statusCode = statusCode
    this.isOperational = true
    Error.captureStackTrace(this, this.constructor)
  }
}

export const errorHandler = (
  err: Error | AppError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  logger.error('Error:', err)

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: err.message,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    })
    return
  }

  if (err.name === 'ValidationError') {
    res.status(400).json({ error: err.message })
    return
  }

  if (err.name === 'JsonWebTokenError') {
    res.status(401).json({ error: 'Invalid token' })
    return
  }

  if (err.name === 'TokenExpiredError') {
    res.status(401).json({ error: 'Token expired' })
    return
  }

  res.status(500).json({
    error: 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  })
}
