/**
 * WattWay · Team Kothimbir 🌿
 * ---------------------------------------------------------------------------
 * logger.ts — a deliberately tiny logger.
 *
 * A course project does not need Winston or Pino. What it does need is one
 * place to silence output during tests, so Jest reports stay readable.
 * ---------------------------------------------------------------------------
 */

/* eslint-disable no-console */

type Level = 'debug' | 'info' | 'warn' | 'error';

const RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

// Tests only ever want to hear about errors.
const threshold = process.env.NODE_ENV === 'test' ? RANK.error : RANK.debug;

const TAG: Record<Level, string> = {
  debug: 'debug',
  info: ' info',
  warn: ' warn',
  error: 'error',
};

function emit(level: Level, message: string, meta?: unknown): void {
  if (RANK[level] < threshold) return;
  const stamp = new Date().toISOString();
  const line = `${stamp} [${TAG[level]}] 🌿 ${message}`;
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  if (meta === undefined) sink(line);
  else sink(line, meta);
}

export const logger = {
  debug: (message: string, meta?: unknown) => emit('debug', message, meta),
  info: (message: string, meta?: unknown) => emit('info', message, meta),
  warn: (message: string, meta?: unknown) => emit('warn', message, meta),
  error: (message: string, meta?: unknown) => emit('error', message, meta),
};

export default logger;
