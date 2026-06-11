import express, { Request, Response, NextFunction } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import dotenv from 'dotenv'
import mongoose from 'mongoose'
import { rateLimit } from 'express-rate-limit'
import compression from 'compression'

import authRoutes from './routes/auth.js'
import campaignRoutes from './routes/campaigns.js'
import contactRoutes from './routes/contacts.js'
import analyticsRoutes from './routes/analytics.js'
import billingRoutes from './routes/billing.js'
import webhookRoutes from './routes/webhooks.js'
import { errorHandler, AppError } from './middleware/errorHandler.js'
import { requestLogger } from './middleware/requestLogger.js'
import logger from './utils/logger.js'
import { closeRedis, initializeRedis } from './config/redis.js'
import { startEmailWorker, stopEmailWorker } from './services/queueService.js'

dotenv.config()

const app = express()

app.set('trust proxy', 1)

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
    },
  },
  crossOriginEmbedderPolicy: false,
}))

app.use(cors({
  // origin: (origin, callback) => {
  //   const allowedOrigins = [
  //     process.env.FRONTEND_URL || 'http://localhost:5173',
  //     'http://localhost:3000',
  //   ]
  //   if (!origin || allowedOrigins.includes(origin)) {
  //     callback(null, true)
  //   } else {
  //     callback(new Error('Not allowed by CORS'))
  //   }
  // },

origin: (origin, callback) => {
  const allowedOrigins = [
    process.env.FRONTEND_URL || "http://localhost:5173",
    "http://localhost:3000",
  ];

  console.log("Origin:", origin);
  console.log("Allowed:", allowedOrigins);

  if (!origin || allowedOrigins.includes(origin)) {
    callback(null, true);
  } else {
    callback(new Error("Not allowed by CORS"));
  }
},




  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-ID', 'X-Request-ID'],
}))

app.use(compression())
app.use(morgan('combined', { stream: { write: (message) => logger.http(message.trim()) } }))
app.use(requestLogger)

app.use('/api/webhooks', webhookRoutes)

app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/health',
  validate: { xForwardedForHeader: false },
})

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
})


app.get('/', (_req, res) => {
  res.json({
    success: true,
    service: 'Email Automation API',
    status: 'running',
  })
})


app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: process.env.npm_package_version || '1.0.0',
  })
})

app.get('/api/health/db', async (_req, res) => {
  try {
    const dbState = mongoose.connection.readyState
    const states: Record<number, string> = {
      0: 'disconnected',
      1: 'connected',
      2: 'connecting',
      3: 'disconnecting',
    }
    res.json({
      status: dbState === 1 ? 'ok' : 'error',
      database: states[dbState],
    })
  } catch {
    res.status(500).json({ status: 'error', database: 'unknown' })
  }
})





app.use('/api', limiter)
app.use('/api/auth/login', authLimiter)
app.use('/api/auth/register', authLimiter)

app.use('/api/auth', authRoutes)
app.use('/api/campaigns', campaignRoutes)
app.use('/api/contacts', contactRoutes)
app.use('/api/analytics', analyticsRoutes)
app.use('/api/billing', billingRoutes)



app.use((_req: Request, _res: Response, next: NextFunction) => {
  next(new AppError('Not Found', 404))
})

app.use(errorHandler)

const PORT = process.env.PORT || 5050
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/email-automation'

const connectWithRetry = async (retries = 5, delay = 5000): Promise<void> => {
  for (let i = 0; i < retries; i++) {
    try {
      await mongoose.connect(MONGODB_URI, {
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
      })
      logger.info('Connected to MongoDB')
      return
    } catch (error) {
      logger.error(`MongoDB connection attempt ${i + 1} failed:`, error)
      if (i < retries - 1) {
        logger.info(`Retrying in ${delay / 1000} seconds...`)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }
  throw new Error('Failed to connect to MongoDB after multiple attempts')
}

const gracefulShutdown = async (signal: string) => {
  logger.info(`${signal} received. Starting graceful shutdown...`)
  
  try {
    await stopEmailWorker()
    await closeRedis()
    await mongoose.connection.close()
    logger.info('MongoDB connection closed')
    process.exit(0)
  } catch (error) {
    logger.error('Error during shutdown:', error)
    process.exit(1)
  }
}

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection:', reason)
})

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error)
  process.exit(1)
})

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

const startServer = async () => {
  try {
    await connectWithRetry()
    
    try {
      await initializeRedis()
      logger.info('Redis connection initialized')
      startEmailWorker()
      logger.info('Email worker started')
    } catch (redisError) {
      logger.warn('Redis not available, queue features disabled:', redisError)
    }
    
    app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`)
    })
  } catch (error) {
    logger.error('Failed to start server:', error)
    process.exit(1)
  }
}

startServer()

export default app
