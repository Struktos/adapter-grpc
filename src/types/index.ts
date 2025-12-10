/**
 * @struktos/adapter-grpc - Type Definitions
 * 
 * Type definitions for gRPC adapter integration with Struktos.js
 */

import type {
  Server,
  ServerCredentials,
  ServiceDefinition,
  UntypedServiceImplementation,
  Metadata,
  ServerUnaryCall,
  ServerReadableStream,
  ServerWritableStream,
  ServerDuplexStream,
  sendUnaryData,
  StatusObject,
} from '@grpc/grpc-js';
import type { StruktosContextData } from '@struktos/core';

// ==================== gRPC Call Types ====================

/**
 * gRPC call types
 */
export type GrpcCallType = 'unary' | 'server-streaming' | 'client-streaming' | 'bidirectional';

/**
 * Generic gRPC call that can be any of the call types
 */
export type GrpcCall<TRequest = any, TResponse = any> =
  | ServerUnaryCall<TRequest, TResponse>
  | ServerReadableStream<TRequest, TResponse>
  | ServerWritableStream<TRequest, TResponse>
  | ServerDuplexStream<TRequest, TResponse>;

/**
 * gRPC callback for sending responses
 */
export type GrpcCallback<TResponse = any> = sendUnaryData<TResponse>;

// ==================== Context Types ====================

/**
 * Extended context data for gRPC requests
 */
export interface GrpcContextData extends StruktosContextData {
  /** gRPC service name */
  serviceName?: string;
  /** gRPC method name */
  methodName?: string;
  /** Full gRPC method path (e.g., /package.Service/Method) */
  methodPath?: string;
  /** gRPC call type */
  callType?: GrpcCallType;
  /** gRPC deadline (if set) */
  deadline?: Date;
  /** Client peer address */
  peer?: string;
  /** gRPC metadata from request */
  metadata?: Record<string, string | string[]>;
  /** Is streaming call */
  isStreaming?: boolean;
}

/**
 * Metadata key constants
 */
export const METADATA_KEYS = {
  TRACE_ID: 'x-trace-id',
  REQUEST_ID: 'x-request-id',
  USER_ID: 'x-user-id',
  AUTHORIZATION: 'authorization',
  CORRELATION_ID: 'x-correlation-id',
} as const;

// ==================== Adapter Options ====================

/**
 * gRPC server options
 */
export interface GrpcServerOptions {
  /** Maximum receive message size in bytes */
  'grpc.max_receive_message_length'?: number;
  /** Maximum send message size in bytes */
  'grpc.max_send_message_length'?: number;
  /** Keepalive time in milliseconds */
  'grpc.keepalive_time_ms'?: number;
  /** Keepalive timeout in milliseconds */
  'grpc.keepalive_timeout_ms'?: number;
  /** Allow keepalive without calls */
  'grpc.keepalive_permit_without_calls'?: number;
  /** HTTP/2 max pings without data */
  'grpc.http2.max_pings_without_data'?: number;
  /** Additional options */
  [key: string]: any;
}

/**
 * gRPC adapter configuration options
 */
export interface GrpcAdapterOptions {
  /** Adapter name */
  name?: string;

  /** Server options */
  serverOptions?: GrpcServerOptions;

  /** Server credentials (default: insecure) */
  credentials?: ServerCredentials;

  /** Custom trace ID generator */
  generateTraceId?: () => string;

  /** Custom request ID generator */
  generateRequestId?: () => string;

  /** Extract user ID from metadata */
  extractUserId?: (metadata: Metadata) => string | undefined;

  /** Enable cancellation propagation */
  enableCancellation?: boolean;

  /** Default timeout in milliseconds */
  defaultTimeout?: number;

  /** Enable request logging */
  enableLogging?: boolean;

  /** Custom metadata transformer */
  metadataTransformer?: (metadata: Metadata) => Record<string, any>;

  /** Error transformer for gRPC status */
  errorTransformer?: (error: Error) => StatusObject;

  /** Called when context is created */
  onContextCreated?: (context: GrpcContextData, call: GrpcCall) => void;

  /** Called when context is destroyed */
  onContextDestroyed?: (context: GrpcContextData, call: GrpcCall) => void;

  /** Called on request completion */
  onRequestComplete?: (context: GrpcContextData, duration: number) => void;
}

// ==================== Service Registration ====================

/**
 * Service definition with implementation
 */
export interface GrpcServiceDefinition {
  /** Service definition from proto */
  definition: ServiceDefinition;
  /** Service implementation */
  implementation: UntypedServiceImplementation;
}

/**
 * Proto loader options
 */
export interface ProtoLoaderOptions {
  /** Keep case for field names */
  keepCase?: boolean;
  /** Use long.js for int64 values */
  longs?: typeof String | typeof Number;
  /** Use enum names instead of numbers */
  enums?: typeof String | typeof Number;
  /** Use Buffer for bytes */
  bytes?: typeof Buffer | typeof Array;
  /** Set default values on output objects */
  defaults?: boolean;
  /** Include virtual oneof fields */
  oneofs?: boolean;
  /** Include directories for imports */
  includeDirs?: string[];
}

// ==================== Interceptor Types ====================

/**
 * gRPC method handler
 */
export type GrpcMethodHandler<TRequest = any, TResponse = any> = (
  call: GrpcCall<TRequest, TResponse>,
  callback?: GrpcCallback<TResponse>
) => void | Promise<void>;

/**
 * Interceptor next function
 */
export type InterceptorNext<TRequest = any, TResponse = any> = (
  call: GrpcCall<TRequest, TResponse>,
  callback?: GrpcCallback<TResponse>
) => void | Promise<void>;

/**
 * Server interceptor function
 */
export type ServerInterceptor<TRequest = any, TResponse = any> = (
  call: GrpcCall<TRequest, TResponse>,
  methodDefinition: MethodDefinition,
  callback: GrpcCallback<TResponse> | undefined,
  next: InterceptorNext<TRequest, TResponse>
) => void | Promise<void>;

/**
 * Method definition for interceptors
 */
export interface MethodDefinition {
  /** Service name */
  service: string;
  /** Method name */
  method: string;
  /** Full path */
  path: string;
  /** Request streaming */
  requestStream: boolean;
  /** Response streaming */
  responseStream: boolean;
}

// ==================== Health Check ====================

/**
 * Health check status
 */
export enum ServingStatus {
  UNKNOWN = 0,
  SERVING = 1,
  NOT_SERVING = 2,
  SERVICE_UNKNOWN = 3,
}

/**
 * Health check response
 */
export interface HealthCheckResponse {
  status: ServingStatus;
}

// ==================== Reflection ====================

/**
 * Service info for reflection
 */
export interface ServiceInfo {
  name: string;
  methods: MethodInfo[];
}

/**
 * Method info for reflection
 */
export interface MethodInfo {
  name: string;
  inputType: string;
  outputType: string;
  clientStreaming: boolean;
  serverStreaming: boolean;
}

// ==================== Re-exports from @grpc/grpc-js ====================

export type {
  Server,
  ServerCredentials,
  ServiceDefinition,
  UntypedServiceImplementation,
  Metadata,
  ServerUnaryCall,
  ServerReadableStream,
  ServerWritableStream,
  ServerDuplexStream,
  sendUnaryData,
  StatusObject,
};

export { status as GrpcStatus } from '@grpc/grpc-js';