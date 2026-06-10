/**
 * Formats a log message with its level, text, and optional metadata.
 *
 * @param level - The log level (e.g., 'info', 'warn', 'error').
 * @param message - The main log message text.
 * @param metadata - Optional key-value pairs of additional metadata to append as JSON.
 * @returns A formatted string in the pattern "[LEVEL] message {"meta":"data"}".
 */
export function formatLogMessage(level: string, message: string, metadata?: Record<string, any>): string {
  const metaString = metadata ? ` ${JSON.stringify(metadata)}` : '';
  return `[${level.toUpperCase()}] ${message}${metaString}`;
}
