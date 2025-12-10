/**
 * @struktos/adapter-grpc v0.1.0
 * 
 * gRPC adapter for Struktos.js - Enterprise-grade gRPC integration
 * with context propagation, middleware support, and cancellation handling.
 * 
 * @example
 * ```typescript
 * import { createGrpcAdapter, createLoggingInterceptor } from '@struktos/adapter-grpc';
 * import { StruktosApp } from '@struktos/core';
 * 
 * const app = StruktosApp.create();
 * app.use(createLoggingInterceptor());
 * 
 * const adapter = createGrpcAdapter({
 *   enableCancellation: true,
 * });
 * 
 * adapter.addProtoService('./protos/service.proto', 'mypackage.MyService', {
 *   myMethod: (call, callback) => {
 *     const ctx = RequestContext.current();
 *     console.log('TraceID:', ctx?.get('traceId'));
 *     callback(null, { result: 'success' });
 *   }
 * });
 * 
 * await app.listen(adapter, 50051);
 * ```
 * 
 * @module @struktos/adapter-grpc
 */

// ==================== Main Adapter ====================
export { 
  GrpcStruktosAdapter, 
  createGrpcAdapter,
} from './adapter';

// ==================== Context ====================
export {
  GrpcContextFactory,
  isUnaryCall,
  isReadableStream,
  isWritableStream,
  isDuplexStream,
  createResponseMetadata,
} from './context';

// ==================== Interceptors ====================
export {
  StruktosInterceptor,
  createLoggingInterceptor,
  createTimeoutInterceptor,
  createRateLimitInterceptor,
} from './interceptors';

// ==================== Types ====================
export type {
  GrpcContextData,
  GrpcAdapterOptions,
  GrpcServerOptions,
  GrpcServiceDefinition,
  GrpcCall,
  GrpcCallType,
  GrpcCallback,
  MethodDefinition,
  ProtoLoaderOptions,
  ServerInterceptor,
  InterceptorNext,
  GrpcMethodHandler,
  ServingStatus,
  HealthCheckResponse,
  ServiceInfo,
  MethodInfo,
} from './types';

export { METADATA_KEYS, GrpcStatus } from './types';

// ==================== Utilities ====================
export {
  generateTraceId,
  generateRequestId,
  generateShortId,
  generateUUID,
  parseTraceId,
} from './utils';

// ==================== Re-exports from @grpc/grpc-js ====================
export {
  Server,
  ServerCredentials,
  Metadata,
  credentials,
  status,
} from '@grpc/grpc-js';

export type {
  ServiceDefinition,
  UntypedServiceImplementation,
  ServerUnaryCall,
  ServerReadableStream,
  ServerWritableStream,
  ServerDuplexStream,
  sendUnaryData,
  StatusObject,
} from '@grpc/grpc-js';

// ==================== Re-export proto-loader ====================
export * as protoLoader from '@grpc/proto-loader';

// ==================== Version ====================
export const VERSION = '0.1.0';

// ==================== Default Export ====================
export { GrpcStruktosAdapter as default } from './adapter';