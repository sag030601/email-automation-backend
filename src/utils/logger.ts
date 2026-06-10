import winston from 'winston'
import path from 'path'

const { combine, timestamp, printf, colorize, errors, json } = winston.format

const customLevels = {
  levels: {
    error: 0,
    warn: 1,
    info: 2,
    http: 3,
    debug: 4,
  },
  colors: {
    error: 'red',
    warn: 'yellow',
    info: 'green',
    http: 'magenta',
    debug: 'cyan',
  },
}

winston.addColors(customLevels.colors)

const logFormat = printf(({ level, message, timestamp, stack, ...metadata }) => {
  let msg = `${timestamp} [${level}]: ${stack || message}`
  if (Object.keys(metadata).length > 0) {
    msg += ` ${JSON.stringify(metadata)}`
  }
  return msg
})

const isDevelopment = process.env.NODE_ENV !== 'production'

const logger = winston.createLogger({
  levels: customLevels.levels,
  level: process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true })
  ),
  transports: [
    new winston.transports.Console({
      format: combine(
        colorize({ all: true }),
        logFormat
      ),
    }),
  ],
  exitOnError: false,
})

if (process.env.NODE_ENV === 'production') {
  const logsDir = process.env.LOGS_DIR || 'logs'
  
  logger.add(new winston.transports.File({
    filename: path.join(logsDir, 'error.log'),
    level: 'error',
    format: combine(json()),
    maxsize: 5242880,
    maxFiles: 5,
  }))

  logger.add(new winston.transports.File({
    filename: path.join(logsDir, 'combined.log'),
    format: combine(json()),
    maxsize: 5242880,
    maxFiles: 5,
  }))
}

export const stream = {
  write: (message: string) => {
    logger.http(message.trim())
  },
}

export default logger
