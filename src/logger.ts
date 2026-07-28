import pino from 'pino';

// Structured JSON logs so Railway / any aggregator can parse event fields.
// Level is overridable; default info in production, debug in development.
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  base:  { service: 'stratum-be' },
  timestamp: pino.stdTimeFunctions.isoTime,
});
