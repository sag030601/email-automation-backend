import mongoose from 'mongoose'
import logger from '../utils/logger.js'

export const connectDatabase = async (): Promise<void> => {
  const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/email-automation'

  mongoose.connection.on('connected', () => {
    logger.info('MongoDB connected')
  })

  mongoose.connection.on('error', (error) => {
    logger.error('MongoDB error:', error)
  })

  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected')
  })

  await mongoose.connect(MONGODB_URI, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  })
}

export const disconnectDatabase = async (): Promise<void> => {
  await mongoose.connection.close()
  logger.info('MongoDB connection closed')
}

export const getDatabaseStatus = (): string => {
  const states: Record<number, string> = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
  }
  return states[mongoose.connection.readyState] || 'unknown'
}
