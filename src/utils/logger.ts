/**
 * Formats a log message with its level, text, and optional metadata.
 *
 * This function handles the consistent formatting of all system logs.
 * Note that if the `metadata` object contains circular references or BigInt values,
 * `JSON.stringify` will throw an error. Callers should ensure metadata is serializable.
 * Functions and Symbols in metadata will be omitted during JSON serialization.
 *
 * @example
 * ```typescript
 * formatLogMessage('info', 'Server started', { port: 8080 });
 * // Returns: '[INFO] Server started {"port":8080}'
 * ```
 *
 * @param level - The severity level of the log (e.g., 'info', 'warn', 'error', 'debug').
 * @param message - The primary text content of the log message.
 * @param metadata - Optional key-value pairs providing additional context to append as a JSON string.
 * @returns A structured log string formatted as "[LEVEL] message {"meta":"data"}".
 */
export function formatLogMessage<T extends Record<string, any> = Record<string, any>>(level: string, message: string, metadata?: T): string {
  const metaString = metadata ? ` ${JSON.stringify(metadata)}` : '';
  return `[${level.toUpperCase()}] ${message}${metaString}`;
}
