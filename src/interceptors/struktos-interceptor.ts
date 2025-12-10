/**
 * @struktos/adapter-grpc - Server Interceptors
 * 
 * Interceptor system that integrates Struktos middleware pipeline with gRPC.
 * Wraps all gRPC method calls to execute middleware before/after processing.
 */

import { status as GrpcStatus, Metadata, StatusObject } from '@grpc/grpc-js';
import {
  RequestContext,
  IStruktosMiddleware,
  MiddlewareContext,
  StruktosRequest,
  StruktosResponse,
  HttpStatus,
} from '@struktos/core';
import {
  GrpcCall,
  GrpcCallback,
  GrpcContextData,
  MethodDefinition,
  GrpcAdapterOptions,
  ServerInterceptor,
} from '../types';
import { GrpcContextFactory, createResponseMetadata } from '../context/factory';

/**
 * StruktosInterceptor - Main interceptor that runs the middleware pipeline
 */
export class StruktosInterceptor {
  private contextFactory: GrpcContextFactory;

  constructor(
    private readonly middlewares: IStruktosMiddleware<GrpcContextData>[],
    private readonly options: GrpcAdapterOptions = {}
  ) {
    this.contextFactory = new GrpcContextFactory(options);
  }

  /**
   * Create an interceptor function for a specific method
   */
  createInterceptor<TRequest = any, TResponse = any>(
    methodDef: MethodDefinition
  ): ServerInterceptor<TRequest, TResponse> {
    return async (call, _methodDefinition, callback, next) => {
      const startTime = Date.now();

      try {
        await this.contextFactory.runWithContext(call, methodDef, async (context) => {
          // Create middleware context
          const middlewareCtx = this.createMiddlewareContext(call, methodDef, context);

          // Execute middleware pipeline
          await this.executePipeline(middlewareCtx);

          // Check if response was set by middleware (e.g., auth failed)
          if (middlewareCtx.response.sent) {
            this.sendErrorResponse(callback, middlewareCtx.response);
            return;
          }

          // Check if cancelled
          if (context.isCancelled()) {
            this.sendCancelledResponse(callback);
            return;
          }

          // Call the actual handler
          await next(call, callback);

          // Call completion hook
          const duration = Date.now() - startTime;
          this.options.onRequestComplete?.(context.getAll() as GrpcContextData, duration);
        });
      } catch (error) {
        this.handleError(error as Error, callback);
      }
    };
  }

  /**
   * Wrap a service implementation with interceptors
   */
  wrapService<T extends object>(
    serviceName: string,
    implementation: T,
    methodDefinitions: Map<string, MethodDefinition>
  ): T {
    const wrapped: any = {};

    for (const [methodName, originalMethod] of Object.entries(implementation)) {
      if (typeof originalMethod !== 'function') {
        wrapped[methodName] = originalMethod;
        continue;
      }

      const methodDef = methodDefinitions.get(methodName) || {
        service: serviceName,
        method: methodName,
        path: `/${serviceName}/${methodName}`,
        requestStream: false,
        responseStream: false,
      };

      wrapped[methodName] = this.wrapMethod(
        originalMethod.bind(implementation),
        methodDef
      );
    }

    return wrapped as T;
  }

  /**
   * Wrap a single method with the middleware pipeline
   */
  private wrapMethod<TRequest = any, TResponse = any>(
    method: (call: GrpcCall<TRequest, TResponse>, callback?: GrpcCallback<TResponse>) => void,
    methodDef: MethodDefinition
  ): (call: GrpcCall<TRequest, TResponse>, callback?: GrpcCallback<TResponse>) => void {
    return async (call, callback) => {
      const startTime = Date.now();

      try {
        await this.contextFactory.runWithContext(call, methodDef, async (context) => {
          // Create middleware context
          const middlewareCtx = this.createMiddlewareContext(call, methodDef, context);

          // Execute middleware pipeline
          await this.executePipeline(middlewareCtx);

          // Check if response was set by middleware
          if (middlewareCtx.response.sent) {
            this.sendErrorResponse(callback, middlewareCtx.response);
            return;
          }

          // Check cancellation
          if (context.isCancelled()) {
            this.sendCancelledResponse(callback);
            return;
          }

          // Add response metadata (trailing)
          const responseMetadata = createResponseMetadata(context);
          call.sendMetadata(responseMetadata);

          // Call original method
          await this.callOriginalMethod(method, call, callback);

          // Completion hook
          const duration = Date.now() - startTime;
          this.options.onRequestComplete?.(context.getAll() as GrpcContextData, duration);
        });
      } catch (error) {
        this.handleError(error as Error, callback);
      }
    };
  }

  /**
   * Create middleware context from gRPC call
   */
  private createMiddlewareContext(
    call: GrpcCall,
    methodDef: MethodDefinition,
    context: RequestContext<GrpcContextData>
  ): MiddlewareContext<GrpcContextData> {
    // Transform gRPC call to StruktosRequest
    const request: StruktosRequest = {
      id: context.get('requestId') || `grpc-${Date.now()}`,
      method: 'POST', // gRPC is always POST-like
      path: methodDef.path,
      headers: this.metadataToHeaders(call.metadata),
      query: {},
      params: {
        service: methodDef.service,
        method: methodDef.method,
      },
      body: (call as any).request,
      ip: call.getPeer?.(),
      protocol: 'grpc',
      raw: call,
      metadata: {
        callType: context.get('callType'),
        deadline: context.get('deadline'),
      },
    };

    // Initial response
    const response: StruktosResponse = {
      status: HttpStatus.OK,
      headers: {},
      sent: false,
    };

    return {
      context,
      request,
      response,
      items: new Map(),
    };
  }

  /**
   * Execute the middleware pipeline
   */
  private async executePipeline(ctx: MiddlewareContext<GrpcContextData>): Promise<void> {
    let index = 0;

    const next = async (): Promise<void> => {
      if (index < this.middlewares.length) {
        const middleware = this.middlewares[index++];
        await middleware.invoke(ctx, next);
      }
    };

    await next();
  }

  /**
   * Call the original gRPC method
   */
  private async callOriginalMethod<TRequest, TResponse>(
    method: (call: GrpcCall<TRequest, TResponse>, callback?: GrpcCallback<TResponse>) => void,
    call: GrpcCall<TRequest, TResponse>,
    callback?: GrpcCallback<TResponse>
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // For streaming, method handles its own completion
        if ((call as any).writable !== undefined || (call as any).readable !== undefined) {
          method(call, callback);
          resolve();
          return;
        }

        // For unary calls, wrap callback
        if (callback) {
          const wrappedCallback: GrpcCallback<TResponse> = (error, response) => {
            if (error) {
              reject(error);
            } else {
              callback(error, response);
              resolve();
            }
          };
          method(call, wrappedCallback);
        } else {
          method(call);
          resolve();
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Convert Metadata to headers record
   */
  private metadataToHeaders(metadata: Metadata): Record<string, string | string[] | undefined> {
    const headers: Record<string, string | string[] | undefined> = {};
    const map = metadata.getMap();
    
    for (const [key, value] of Object.entries(map)) {
      // Convert Buffer to string if necessary
      if (Buffer.isBuffer(value)) {
        headers[key] = value.toString('utf-8');
      } else {
        headers[key] = value as string | string[];
      }
    }
    
    return headers;
  }

  /**
   * Send error response through callback
   */
  private sendErrorResponse<TResponse>(
    callback: GrpcCallback<TResponse> | undefined,
    response: StruktosResponse
  ): void {
    if (!callback) return;

    const grpcStatus = this.httpStatusToGrpcStatus(response.status);
    const message = typeof response.body === 'object' 
      ? response.body.message || 'Error'
      : String(response.body || 'Error');

    const error: StatusObject = {
      code: grpcStatus,
      details: message,
      metadata: new Metadata(),
    };

    // Add error details to metadata if present
    if (response.body && typeof response.body === 'object') {
      error.metadata?.set('error-details', JSON.stringify(response.body));
    }

    callback(error as any, null as any);
  }

  /**
   * Send cancelled response
   */
  private sendCancelledResponse<TResponse>(callback: GrpcCallback<TResponse> | undefined): void {
    if (!callback) return;

    callback(
      {
        code: GrpcStatus.CANCELLED,
        details: 'Request was cancelled',
        metadata: new Metadata(),
      } as any,
      null as any
    );
  }

  /**
   * Handle error and send appropriate gRPC response
   */
  private handleError<TResponse>(error: Error, callback: GrpcCallback<TResponse> | undefined): void {
    if (!callback) {
      console.error('Unhandled gRPC error:', error);
      return;
    }

    let statusObject: StatusObject;

    // Use custom error transformer if provided
    if (this.options.errorTransformer) {
      statusObject = this.options.errorTransformer(error);
    } else {
      statusObject = this.defaultErrorTransformer(error);
    }

    callback(statusObject as any, null as any);
  }

  /**
   * Default error transformer
   */
  private defaultErrorTransformer(error: Error): StatusObject {
    // Check for HTTP-style status codes
    const statusCode = (error as any).statusCode || (error as any).status;
    
    let grpcCode = GrpcStatus.INTERNAL;
    if (statusCode) {
      grpcCode = this.httpStatusToGrpcStatus(statusCode);
    }

    // Check for explicit gRPC code
    if (typeof (error as any).code === 'number') {
      grpcCode = (error as any).code;
    }

    return {
      code: grpcCode,
      details: error.message,
      metadata: new Metadata(),
    };
  }

  /**
   * Map HTTP status to gRPC status
   */
  private httpStatusToGrpcStatus(httpStatus: number): number {
    const mapping: Record<number, number> = {
      200: GrpcStatus.OK,
      400: GrpcStatus.INVALID_ARGUMENT,
      401: GrpcStatus.UNAUTHENTICATED,
      403: GrpcStatus.PERMISSION_DENIED,
      404: GrpcStatus.NOT_FOUND,
      409: GrpcStatus.ALREADY_EXISTS,
      429: GrpcStatus.RESOURCE_EXHAUSTED,
      499: GrpcStatus.CANCELLED,
      500: GrpcStatus.INTERNAL,
      501: GrpcStatus.UNIMPLEMENTED,
      503: GrpcStatus.UNAVAILABLE,
      504: GrpcStatus.DEADLINE_EXCEEDED,
    };

    return mapping[httpStatus] ?? GrpcStatus.INTERNAL;
  }
}

/**
 * Create a logging interceptor
 */
export function createLoggingInterceptor(
  options: { logRequests?: boolean; logResponses?: boolean } = {}
): IStruktosMiddleware<GrpcContextData> {
  const { logRequests = true, logResponses = true } = options;

  return {
    async invoke(ctx, next) {
      const traceId = ctx.context.get('traceId');
      const method = ctx.request.params.method;
      const service = ctx.request.params.service;

      if (logRequests) {
        console.log(`[${traceId}] → gRPC ${service}/${method}`);
      }

      const start = Date.now();
      await next();
      const duration = Date.now() - start;

      if (logResponses) {
        console.log(`[${traceId}] ← gRPC ${ctx.response.status} (${duration}ms)`);
      }
    },
  };
}

/**
 * Create a timeout interceptor
 */
export function createTimeoutInterceptor(
  timeoutMs: number
): IStruktosMiddleware<GrpcContextData> {
  return {
    async invoke(ctx, next) {
      const context = ctx.context;
      
      // Setup timeout cancellation
      const timeoutId = setTimeout(() => {
        if (!context.isCancelled()) {
          context.cancel();
        }
      }, timeoutMs);

      try {
        await next();
      } finally {
        clearTimeout(timeoutId);
      }
    },
  };
}

/**
 * Create a rate limiting interceptor
 */
export function createRateLimitInterceptor(
  maxRequests: number,
  windowMs: number
): IStruktosMiddleware<GrpcContextData> {
  const requests = new Map<string, number[]>();

  return {
    async invoke(ctx, next) {
      const key = ctx.request.ip || 'unknown';
      const now = Date.now();
      const windowStart = now - windowMs;

      // Get timestamps for this key
      let timestamps = requests.get(key) || [];
      
      // Filter to only include requests in current window
      timestamps = timestamps.filter((t) => t > windowStart);

      if (timestamps.length >= maxRequests) {
        ctx.response.status = 429;
        ctx.response.body = {
          error: 'Too Many Requests',
          message: 'Rate limit exceeded',
        };
        ctx.response.sent = true;
        return;
      }

      timestamps.push(now);
      requests.set(key, timestamps);

      await next();
    },
  };
}