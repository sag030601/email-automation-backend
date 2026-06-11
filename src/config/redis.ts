import { Redis } from 'ioredis'
import logger from '../utils/logger.js'

let redisClient: Redis | null = null
let redisEnabled = false

export const getRedisConfig = () => {
  const isUpstash = process.env.REDIS_HOST?.includes('upstash.io')
  
  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    connectTimeout: 10000,
    tls: isUpstash ? {} : undefined,
  }
}

export const initializeRedis = async (): Promise<Redis | null> => {
  if (process.env.REDIS_ENABLED === 'false') {
    logger.info('Redis disabled via config')
    return null
  }

  if (redisClient) {
    return redisClient
  }

  try {
    redisClient = new Redis(getRedisConfig())

    redisClient.on('error', () => {
      // Silently ignore Redis errors when not available
    })

    await redisClient.ping()
    redisEnabled = true
    logger.info('Redis connected successfully')
    return redisClient
  } catch {
    logger.info('Redis not available - queue features disabled')
    if (redisClient) {
      redisClient.disconnect()
      redisClient = null
    }
    return null
  }
}

export const isRedisEnabled = (): boolean => redisEnabled

export const getRedisClient = (): Redis | null => redisEnabled ? redisClient : null

export const closeRedis = async (): Promise<void> => {
  if (redisClient) {
    try {
      await redisClient.quit()
    } catch {
      // Ignore close errors
    }
    redisClient = null
    redisEnabled = false
  }
}
