/**
 * @struktos/adapter-grpc - Context Transformation
 * 
 * Transforms gRPC request metadata and call information into Struktos RequestContext.
 * Handles trace ID propagation, user extraction, and cancellation token integration.
 */

import { Metadata } from '@grpc/grpc-js';
import { RequestContext } from '@struktos/core';
import {
  GrpcContextData,
  GrpcCall,
  GrpcCallType,
  GrpcAdapterOptions,
  MethodDefinition,
  METADATA_KEYS,
  ServerUnaryCall,
  ServerReadableStream,
  ServerWritableStream,
  ServerDuplexStream,
} from '../types';
import { generateTraceId, generateRequestId } from '../utils/id-generator';

/**
 * GrpcContextFactory - Creates and manages Struktos context for gRPC calls
 */
export class GrpcContextFactory {
  constructor(private readonly options: GrpcAdapterOptions = {}) {}

  /**
   * Create a Struktos context from a gRPC call
   */
  createContext(
    call: GrpcCall,
    methodDef: MethodDefinition
  ): GrpcContextData {
    const metadata = this.extractMetadata(call);
    const callType = this.determineCallType(methodDef);

    // Extract or generate IDs
    const traceId = this.extractTraceId(metadata) || 
                    (this.options.generateTraceId?.() ?? generateTraceId());
    const requestId = this.extractRequestId(metadata) || 
                      (this.options.generateRequestId?.() ?? generateRequestId());
    const userId = this.options.extractUserId?.(metadata) ?? 
                   this.extractUserId(metadata);

    // Build context data
    const contextData: GrpcContextData = {
      traceId,
      requestId,
      userId,
      timestamp: Date.now(),
      serviceName: methodDef.service,
      methodName: methodDef.method,
      methodPath: methodDef.path,
      callType,
      peer: this.extractPeer(call),
      metadata: this.metadataToRecord(metadata),
      isStreaming: methodDef.requestStream || methodDef.responseStream,
    };

    // Add deadline if present
    const deadline = this.extractDeadline(call);
    if (deadline) {
      contextData.deadline = deadline;
    }

    // Apply custom metadata transformer
    if (this.options.metadataTransformer) {
      const customData = this.options.metadataTransformer(metadata);
      Object.assign(contextData, customData);
    }

    return contextData;
  }

  /**
   * Run a function within a Struktos context
   */
  runWithContext<T>(
    call: GrpcCall,
    methodDef: MethodDefinition,
    fn: (context: RequestContext<GrpcContextData>) => T
  ): T {
    const contextData = this.createContext(call, methodDef);

    return RequestContext.run(contextData, () => {
      const context = RequestContext.current<GrpcContextData>();
      if (!context) {
        throw new Error('Failed to create RequestContext');
      }

      // Setup cancellation if enabled
      if (this.options.enableCancellation !== false) {
        this.setupCancellation(call, context);
      }

      // Call lifecycle hook
      this.options.onContextCreated?.(contextData, call);

      return fn(context);
    });
  }

  /**
   * Setup cancellation token integration with gRPC call
   */
  private setupCancellation(
    call: GrpcCall,
    context: RequestContext<GrpcContextData>
  ): void {
    // Type-safe event handling using type assertion
    const eventEmitter = call as unknown as NodeJS.EventEmitter;

    // Handle client-initiated cancellation
    eventEmitter.on('cancelled', () => {
      context.cancel();
    });

    // Handle call end/close
    eventEmitter.on('close', () => {
      // Context cleanup - note: don't cancel here as it might be normal completion
    });

    // Handle errors that should trigger cancellation
    eventEmitter.on('error', (error: Error) => {
      // Only cancel if it's a cancellation-related error
      if (this.isCancellationError(error)) {
        context.cancel();
      }
    });

    // Setup deadline-based cancellation
    const deadline = this.extractDeadline(call);
    if (deadline) {
      const timeoutMs = deadline.getTime() - Date.now();
      if (timeoutMs > 0) {
        const timeoutId = setTimeout(() => {
          if (!context.isCancelled()) {
            context.cancel();
          }
        }, timeoutMs);

        // Clear timeout if context is cancelled early
        context.onCancel(() => {
          clearTimeout(timeoutId);
        });
      } else {
        // Already past deadline
        context.cancel();
      }
    }
  }

  /**
   * Extract metadata from gRPC call
   */
  private extractMetadata(call: GrpcCall): Metadata {
    return call.metadata || new Metadata();
  }

  /**
   * Extract trace ID from metadata
   */
  private extractTraceId(metadata: Metadata): string | undefined {
    const values = metadata.get(METADATA_KEYS.TRACE_ID);
    return values.length > 0 ? String(values[0]) : undefined;
  }

  /**
   * Extract request ID from metadata
   */
  private extractRequestId(metadata: Metadata): string | undefined {
    const values = metadata.get(METADATA_KEYS.REQUEST_ID);
    return values.length > 0 ? String(values[0]) : undefined;
  }

  /**
   * Extract user ID from metadata
   */
  private extractUserId(metadata: Metadata): string | undefined {
    const values = metadata.get(METADATA_KEYS.USER_ID);
    return values.length > 0 ? String(values[0]) : undefined;
  }

  /**
   * Extract peer address from call
   */
  private extractPeer(call: GrpcCall): string | undefined {
    return call.getPeer?.();
  }

  /**
   * Extract deadline from call
   */
  private extractDeadline(call: GrpcCall): Date | undefined {
    const deadline = (call as any).getDeadline?.();
    if (deadline && deadline !== Infinity) {
      if (deadline instanceof Date) {
        return deadline;
      }
      if (typeof deadline === 'number') {
        return new Date(deadline);
      }
    }
    return undefined;
  }

  /**
   * Determine the gRPC call type from method definition
   */
  private determineCallType(methodDef: MethodDefinition): GrpcCallType {
    if (methodDef.requestStream && methodDef.responseStream) {
      return 'bidirectional';
    }
    if (methodDef.requestStream) {
      return 'client-streaming';
    }
    if (methodDef.responseStream) {
      return 'server-streaming';
    }
    return 'unary';
  }

  /**
   * Convert Metadata to Record
   */
  private metadataToRecord(metadata: Metadata): Record<string, string | string[]> {
    const record: Record<string, string | string[]> = {};
    const map = metadata.getMap();
    
    for (const [key, value] of Object.entries(map)) {
      // Convert Buffer to string if necessary
      if (Buffer.isBuffer(value)) {
        record[key] = value.toString('utf-8');
      } else {
        record[key] = value as string | string[];
      }
    }
    
    return record;
  }

  /**
   * Check if error is a cancellation-related error
   */
  private isCancellationError(error: Error): boolean {
    const message = error.message.toLowerCase();
    return (
      message.includes('cancelled') ||
      message.includes('canceled') ||
      message.includes('deadline') ||
      (error as any).code === 1 // CANCELLED
    );
  }
}

/**
 * Helper to check if call is a specific type
 */
export function isUnaryCall<TReq, TRes>(
  call: GrpcCall<TReq, TRes>
): call is ServerUnaryCall<TReq, TRes> {
  return !isReadableStream(call) && !isWritableStream(call);
}

export function isReadableStream<TReq, TRes>(
  call: GrpcCall<TReq, TRes>
): call is ServerReadableStream<TReq, TRes> {
  return typeof (call as any).on === 'function' && 
         typeof (call as any).read === 'function';
}

export function isWritableStream<TReq, TRes>(
  call: GrpcCall<TReq, TRes>
): call is ServerWritableStream<TReq, TRes> {
  return typeof (call as any).write === 'function' &&
         typeof (call as any).end === 'function';
}

export function isDuplexStream<TReq, TRes>(
  call: GrpcCall<TReq, TRes>
): call is ServerDuplexStream<TReq, TRes> {
  return isReadableStream(call) && isWritableStream(call);
}

/**
 * Create response metadata with trace information
 */
export function createResponseMetadata(
  context: RequestContext<GrpcContextData>
): Metadata {
  const metadata = new Metadata();
  
  const traceId = context.get('traceId');
  if (traceId) {
    metadata.set(METADATA_KEYS.TRACE_ID, traceId);
  }
  
  const requestId = context.get('requestId');
  if (requestId) {
    metadata.set(METADATA_KEYS.REQUEST_ID, requestId);
  }
  
  return metadata;
}