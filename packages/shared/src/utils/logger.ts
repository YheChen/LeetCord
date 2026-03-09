import pino, { Logger as PinoLogger } from 'pino';

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

export interface LoggerOptions {
  level?: LogLevel;
  name?: string;
}

export type Logger = PinoLogger;

export const createLogger = (options?: LoggerOptions): Logger => {
  const level: LogLevel = options?.level ?? (process.env.LOG_LEVEL as LogLevel) ?? 'info';

  return pino({
    level,
    name: options?.name ?? 'leetcord'
  });
};

