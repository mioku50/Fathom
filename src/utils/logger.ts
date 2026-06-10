export function formatLogMessage(level: string, message: string, metadata?: Record<string, any>): string {
  const metaString = metadata ? ` ${JSON.stringify(metadata)}` : '';
  return `[${level.toUpperCase()}] ${message}${metaString}`;
}
