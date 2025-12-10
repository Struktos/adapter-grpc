# Changelog

All notable changes to `@struktos/adapter-grpc` will be documented in this file.

## [0.1.0] - 2024-12-10

### 🎉 Initial Release

First release of the gRPC adapter for Struktos.js platform.

### Added

#### Core Adapter

**GrpcStruktosAdapter**
- Implements `IGrpcAdapter` interface from `@struktos/core`
- Protocol type: `'grpc'`
- Proto file loading via `@grpc/proto-loader`
- Service registration with `addService()` and `addProtoService()`
- Health check status management

**Configuration Options**
- Server options (message size, keepalive, etc.)
- Server credentials support
- Custom ID generators (trace ID, request ID)
- User extraction from metadata
- Cancellation handling toggle
- Lifecycle hooks (onContextCreated, onContextDestroyed, onRequestComplete)
- Custom error transformer

#### Context Propagation

**GrpcContextFactory**
- Transforms gRPC Metadata → Struktos RequestContext
- Trace ID propagation via `x-trace-id` metadata
- Request ID, User ID extraction
- Deadline/timeout detection
- Peer address extraction

**GrpcContextData**
- Extended context data for gRPC
- Service name, method name, method path
- Call type (unary, server-streaming, client-streaming, bidirectional)
- gRPC deadline as Date
- Original metadata as Record

#### Cancellation Integration

- gRPC client cancellation → Struktos cancellation token
- gRPC deadline → automatic timeout cancellation
- `context.isCancelled()` check in handlers
- `context.onCancel()` cleanup callbacks

#### Interceptor System

**StruktosInterceptor**
- Wraps all service methods with middleware pipeline
- HTTP status → gRPC status mapping
- Error transformation to StatusObject
- Response metadata injection (X-Trace-Id)

**Built-in Interceptors**
- `createLoggingInterceptor()` - Request/response logging
- `createTimeoutInterceptor()` - Additional timeout control
- `createRateLimitInterceptor()` - Rate limiting per client

#### RPC Type Support
- ✅ Unary RPC
- ✅ Server Streaming RPC
- ✅ Client Streaming RPC
- ✅ Bidirectional Streaming RPC

#### Types

**Request/Response Types**
- `GrpcCall<TRequest, TResponse>` - Union of all call types
- `GrpcCallback<TResponse>` - Unary callback type
- `GrpcCallType` - 'unary' | 'server-streaming' | 'client-streaming' | 'bidirectional'

**Configuration Types**
- `GrpcAdapterOptions` - Adapter configuration
- `GrpcServerOptions` - gRPC server options
- `MethodDefinition` - Method metadata
- `ProtoLoaderOptions` - Proto loader configuration

**Health Check**
- `ServingStatus` enum
- `HealthCheckResponse` interface

### Utilities

**ID Generation**
- `generateTraceId()` - gRPC trace ID format
- `generateRequestId()` - Request ID format
- `generateUUID()` - UUID v4 format
- `parseTraceId()` - Extract timestamp from trace ID

**Call Type Detection**
- `isUnaryCall()`
- `isReadableStream()`
- `isWritableStream()`
- `isDuplexStream()`

### Examples

- Basic server example with Greeter and UserService
- Client example demonstrating all RPC types
- Proto file for example services

### Dependencies

**Peer Dependencies**
- `@struktos/core` ^1.0.0

**Dependencies**
- `@grpc/grpc-js` ^1.12.5
- `@grpc/proto-loader` ^0.7.13

### Architecture

```
GrpcStruktosAdapter
├── StruktosInterceptor (wraps all methods)
│   └── Middleware Pipeline
│       ├── Logging
│       ├── Auth
│       ├── Validation
│       └── ... (user middlewares)
├── GrpcContextFactory
│   ├── Metadata → Context
│   └── Cancellation Setup
└── Service Implementations
    └── RequestContext.current() available
```

---

## Roadmap

### 0.2.0 (Planned)
- [ ] Official health check proto integration
- [ ] Reflection service support
- [ ] Connection pooling utilities
- [ ] Metrics collection

### 0.3.0 (Planned)
- [ ] TLS/mTLS helpers
- [ ] Load balancing support
- [ ] Circuit breaker pattern
- [ ] Retry policies

---

## Links

- [NPM Package](https://www.npmjs.com/package/@struktos/adapter-grpc)
- [GitHub Repository](https://github.com/struktosjs/adapter-grpc)
- [@struktos/core](https://www.npmjs.com/package/@struktos/core)

---

## License

MIT © Struktos.js Team