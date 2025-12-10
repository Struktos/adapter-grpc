/**
 * @struktos/adapter-grpc - ID Generator Utilities
 * 
 * Utilities for generating trace IDs, request IDs, and other identifiers.
 */

/**
 * Generate a trace ID for distributed tracing
 */
export function generateTraceId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `grpc-${timestamp}-${random}`;
}

/**
 * Generate a request ID
 */
export function generateRequestId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 6);
  return `req-${timestamp}-${random}`;
}

/**
 * Generate a short unique ID
 */
export function generateShortId(): string {
  return Math.random().toString(36).substring(2, 10);
}

/**
 * Generate UUID v4 compatible ID
 */
export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Parse trace ID to extract timestamp (if possible)
 */
export function parseTraceId(traceId: string): { timestamp?: number; type?: string } {
  const parts = traceId.split('-');
  
  if (parts.length >= 2) {
    const type = parts[0];
    const timestamp = parseInt(parts[1], 36);
    
    if (!isNaN(timestamp)) {
      return { timestamp, type };
    }
  }
  
  return {};
}