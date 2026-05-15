import winston from 'winston';
import path from 'path';
import fs from 'fs';
import config from '../config.js';

const logDir = config.logDir || path.resolve(process.cwd(), 'logs');

try {
  fs.mkdirSync(logDir, { recursive: true });
} catch {
  /* ignore */
}

const logger = winston.createLogger({
  level: config.logLevel || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
      const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
      const stackStr = stack ? '\n' + stack : '';
      return `${timestamp} [${level.toUpperCase()}] ${message}${metaStr}${stackStr}`;
    }),
  ),
  transports: [
    new winston.transports.File({
      filename: path.join(logDir, 'app.log'),
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
      tailable: true,
    }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
          const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
          const stackStr = stack ? '\n' + stack : '';
          return `${timestamp} ${level} ${message}${metaStr}${stackStr}`;
        }),
      ),
    }),
  ],
});

export default logger;
