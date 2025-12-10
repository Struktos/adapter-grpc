# @struktos/adapter-grpc

> gRPC adapter for Struktos.js - Enterprise-grade gRPC integration with context propagation and middleware support

[![npm version](https://img.shields.io/npm/v/@struktos/adapter-grpc.svg)](https://www.npmjs.com/package/@struktos/adapter-grpc)
[![CI](https://github.com/struktosjs/adapter-grpc/actions/workflows/ci.yml/badge.svg)](https://github.com/struktosjs/adapter-grpc/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org)

## 🎯 Overview

`@struktos/adapter-grpc` integrates gRPC with the Struktos.js platform, providing:

- ✅ **Context Propagation** - Automatic trace ID and metadata propagation
- ✅ **Middleware Pipeline** - Full Struktos middleware support for gRPC
- ✅ **Cancellation Handling** - gRPC deadline and cancellation → Struktos cancellation token
- ✅ **Interceptor System** - Wrap all service methods with middleware
- ✅ **Health Checks** - Built-in gRPC health check service
- ✅ **All RPC Types** - Unary, server streaming, client streaming, bidirectional
- ✅ **Fully Tested** - 69+ tests with unit and integration coverage

## 📦 Installation

```bash
npm install @struktos/adapter-grpc @struktos/core @grpc/grpc-js
```

## 🚀 Quick Start

```typescript
import { createGrpcAdapter, createLoggingInterceptor } from '@struktos/adapter-grpc';
import { StruktosApp, RequestContext } from '@struktos/core';

// Create app with middleware
const app = StruktosApp.create();
app.use(createLoggingInterceptor());

// Create gRPC adapter
const adapter = createGrpcAdapter({
  enableCancellation: true,
});

// Add service from proto
await adapter.addProtoService('./protos/greeter.proto', 'example.Greeter', {
  SayHello: (call, callback) => {
    const ctx = RequestContext.current();
    console.log('TraceID:', ctx?.get('traceId'));
    
    callback(null, {
      message: `Hello, ${call.request.name}!`,
    });
  },
});

// Start server
await app.listen(adapter, 50051);
console.log('gRPC server running on port 50051');
```

## 📖 Core Concepts

### Context Propagation

gRPC metadata is automatically transformed into Struktos RequestContext:

```typescript
// Client sends metadata
const metadata = new grpc.Metadata();
metadata.set('x-trace-id', 'trace-123');
metadata.set('x-user-id', 'user-456');
metadata.set('authorization', 'Bearer token');

client.SayHello(request, metadata, callback);

// Server receives context
const ctx = RequestContext.current<GrpcContextData>();
console.log(ctx.get('traceId'));   // 'trace-123'
console.log(ctx.get('userId'));    // 'user-456'
console.log(ctx.get('serviceName')); // 'example.Greeter'
console.log(ctx.get('methodName')); // 'SayHello'
```

### Cancellation Handling

gRPC cancellation signals are integrated with Struktos cancellation tokens:

```typescript
// Deadline from client
const deadline = new Date(Date.now() + 5000); // 5 seconds
client.SayHello(request, metadata, { deadline }, callback);

// Server-side cancellation handling
const implementation = {
  SayHello: async (call, callback) => {
    const ctx = RequestContext.current();
    
    // Register cleanup callback
    ctx.onCancel(() => {
      console.log('Request was cancelled!');
      // Clean up resources
    });
    
    // Check cancellation during long operations
    for (const item of items) {
      if (ctx.isCancelled()) {
        callback({ code: 1, details: 'Cancelled' }, null);
        return;
      }
      await processItem(item);
    }
    
    callback(null, result);
  },
};
```

### Middleware Pipeline

All Struktos middlewares work with gRPC:

```typescript
import { createMiddleware, BadRequestException } from '@struktos/core';

// Authentication middleware
const authMiddleware = createMiddleware(async (ctx, next) => {
  const authHeader = ctx.request.headers['authorization'];
  
  if (!authHeader) {
    ctx.response.status = 401;
    ctx.response.body = { error: 'Unauthorized' };
    ctx.response.sent = true;
    return; // Short-circuit pipeline
  }
  
  // Validate token and set user
  ctx.context.set('userId', 'user-123');
  await next();
});

// Validation middleware
const validationMiddleware = createMiddleware(async (ctx, next) => {
  const { name } = ctx.request.body;
  
  if (!name) {
    throw new BadRequestException('Name is required');
  }
  
  await next();
});

// Use in app
app.use(authMiddleware);
app.use(validationMiddleware);
```

### Built-in Interceptors

```typescript
import {
  createLoggingInterceptor,
  createTimeoutInterceptor,
  createRateLimitInterceptor,
} from '@struktos/adapter-grpc';

// Logging
app.use(createLoggingInterceptor({
  logRequests: true,
  logResponses: true,
}));

// Timeout (in addition to gRPC deadline)
app.use(createTimeoutInterceptor(30000)); // 30 seconds

// Rate limiting
app.use(createRateLimitInterceptor(100, 60000)); // 100 requests per minute
```

## 🔧 Configuration

### Adapter Options

```typescript
const adapter = createGrpcAdapter({
  // Adapter identification
  name: 'my-grpc-adapter',
  
  // Server options
  serverOptions: {
    'grpc.max_receive_message_length': 4 * 1024 * 1024, // 4MB
    'grpc.max_send_message_length': 4 * 1024 * 1024,
    'grpc.keepalive_time_ms': 30000,
  },
  
  // Credentials (default: insecure)
  credentials: ServerCredentials.createInsecure(),
  
  // Custom ID generators
  generateTraceId: () => `custom-${Date.now()}`,
  generateRequestId: () => `req-${Date.now()}`,
  
  // User extraction from metadata
  extractUserId: (metadata) => metadata.get('x-user-id')[0] as string,
  
  // Cancellation support
  enableCancellation: true,
  
  // Lifecycle hooks
  onContextCreated: (ctx, call) => {
    console.log(`Context created for ${ctx.methodPath}`);
  },
  onRequestComplete: (ctx, duration) => {
    console.log(`Request completed in ${duration}ms`);
  },
  
  // Custom error transformer
  errorTransformer: (error) => ({
    code: error.statusCode || 13,
    details: error.message,
    metadata: new Metadata(),
  }),
});
```

### Loading Proto Files

```typescript
// Single service
await adapter.addProtoService(
  './protos/greeter.proto',
  'example.Greeter',
  greeterImplementation
);

// Multiple services from one proto
await adapter.loadProtoPackage('./protos/api.proto', {
  'example.Greeter': greeterImplementation,
  'example.UserService': userImplementation,
});

// Proto loader options
await adapter.addProtoService(
  './protos/greeter.proto',
  'example.Greeter',
  implementation,
  {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
    includeDirs: ['./protos'],
  }
);
```

## 📊 RPC Type Support

### Unary RPC

```typescript
const service = {
  GetUser: (call, callback) => {
    const user = findUser(call.request.id);
    callback(null, user);
  },
};
```

### Server Streaming

```typescript
const service = {
  ListUsers: (call) => {
    const users = getAllUsers();
    for (const user of users) {
      call.write(user);
    }
    call.end();
  },
};
```

### Client Streaming

```typescript
const service = {
  CreateUsers: (call, callback) => {
    const users = [];
    
    call.on('data', (user) => {
      users.push(createUser(user));
    });
    
    call.on('end', () => {
      callback(null, { count: users.length });
    });
  },
};
```

### Bidirectional Streaming

```typescript
const service = {
  Chat: (call) => {
    call.on('data', (message) => {
      // Echo back
      call.write({ reply: `Received: ${message.text}` });
    });
    
    call.on('end', () => {
      call.end();
    });
  },
};
```

## 🏥 Health Checks

```typescript
// Set health status
adapter.setHealthStatus('example.Greeter', ServingStatus.SERVING);
adapter.setHealthStatus('example.UserService', ServingStatus.NOT_SERVING);

// Get health status
const status = adapter.getHealthStatus('example.Greeter');
```

## 🔄 Context Data

The `GrpcContextData` interface extends `StruktosContextData`:

```typescript
interface GrpcContextData extends StruktosContextData {
  traceId?: string;
  requestId?: string;
  userId?: string;
  timestamp?: number;
  
  // gRPC-specific
  serviceName?: string;    // e.g., 'example.Greeter'
  methodName?: string;     // e.g., 'SayHello'
  methodPath?: string;     // e.g., '/example.Greeter/SayHello'
  callType?: GrpcCallType; // 'unary' | 'server-streaming' | etc.
  deadline?: Date;
  peer?: string;           // Client address
  metadata?: Record<string, string | string[]>;
  isStreaming?: boolean;
}
```

## 📋 Metadata Keys

```typescript
import { METADATA_KEYS } from '@struktos/adapter-grpc';

// Standard metadata keys
METADATA_KEYS.TRACE_ID        // 'x-trace-id'
METADATA_KEYS.REQUEST_ID      // 'x-request-id'
METADATA_KEYS.USER_ID         // 'x-user-id'
METADATA_KEYS.AUTHORIZATION   // 'authorization'
METADATA_KEYS.CORRELATION_ID  // 'x-correlation-id'
```

## 🧪 Testing

The package includes comprehensive test coverage with both unit and integration tests.

### Running Tests

```bash
# Run all tests
npm test

# Run unit tests only
npm run test:unit

# Run integration tests only
npm run test:integration

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

### Test Structure

```
tests/
├── unit/
│   ├── id-generator.test.ts      # ID generation utilities
│   ├── context-factory.test.ts   # Context transformation
│   ├── grpc-adapter.test.ts      # Adapter functionality
│   └── interceptor.test.ts       # Middleware interceptors
├── integration/
│   └── grpc-server.test.ts       # Full server/client tests
├── fixtures/
│   └── test.proto                # Test proto files (auto-generated)
└── setup.ts                      # Jest setup
```

### Test Coverage

| Component | Tests | Coverage |
|-----------|-------|----------|
| ID Generator | 11 | ✅ |
| Context Factory | 19 | ✅ |
| gRPC Adapter | 21 | ✅ |
| Interceptors | 10 | ✅ |
| Integration | 8 | ✅ |
| **Total** | **69** | **70%+** |

### Writing Tests

```typescript
import { GrpcStruktosAdapter, createGrpcAdapter } from '@struktos/adapter-grpc';

describe('My gRPC Service', () => {
  let adapter: GrpcStruktosAdapter;

  beforeEach(async () => {
    adapter = createGrpcAdapter();
    await adapter.init([]);
  });

  afterEach(async () => {
    if (adapter.isRunning()) {
      await adapter.stop();
    }
  });

  it('should handle requests', async () => {
    // Add your service
    adapter.addService(definition, implementation);
    
    // Start server
    await adapter.start(50099);
    
    // Test with client...
  });
});
```

## 🔄 CI/CD

### GitHub Actions Workflows

The package includes three GitHub Actions workflows:

#### 1. CI (`ci.yml`)
Runs on every push and pull request:
- Tests on Node.js 18, 20, 22
- TypeScript type checking
- Build verification

#### 2. Auto Release (`auto-release.yml`)
Automatically releases when pushing to main with version changes:
- Detects version change in `package.json`
- Runs tests
- Creates GitHub Release
- Publishes to npm

#### 3. Manual Release (`release.yml`)
Triggered by tag push or manual workflow dispatch:
- Creates GitHub Release with changelog
- Publishes to npm

### Release Process

#### Automatic Release (Recommended)

```bash
# 1. Bump version
npm version patch  # 0.1.0 → 0.1.1
# or
npm version minor  # 0.1.0 → 0.2.0
# or
npm version major  # 0.1.0 → 1.0.0

# 2. Push to main
git push origin main

# → Auto: Test → Tag → GitHub Release → npm publish
```

#### Manual Release

```bash
# Using release script
./scripts/release.sh patch
./scripts/release.sh minor
./scripts/release.sh major
```

### Required Secrets

Configure these in GitHub repository settings:

| Secret | Description |
|--------|-------------|
| `NPM_TOKEN` | npm authentication token |

## 🛠️ Development

### Setup

```bash
# Clone repository
git clone https://github.com/struktosjs/adapter-grpc.git
cd adapter-grpc

# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test
```

### Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Compile TypeScript |
| `npm test` | Run all tests |
| `npm run test:unit` | Run unit tests |
| `npm run test:integration` | Run integration tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage |
| `npm run example` | Run example server |
| `npm run example:client` | Run example client |

### Project Structure

```
@struktos/adapter-grpc/
├── src/
│   ├── adapter/          # Main adapter implementation
│   ├── context/          # Context transformation
│   ├── interceptors/     # Middleware interceptors
│   ├── types/            # TypeScript types
│   ├── utils/            # Utilities
│   └── index.ts          # Main exports
├── tests/
│   ├── unit/             # Unit tests
│   ├── integration/      # Integration tests
│   └── setup.ts          # Test setup
├── examples/
│   ├── basic-server.ts   # Example server
│   └── basic-client.ts   # Example client
├── protos/
│   └── example.proto     # Example proto
├── .github/workflows/    # CI/CD workflows
└── scripts/
    └── release.sh        # Release script
```

## 🤝 Related Packages

- **[@struktos/core](https://www.npmjs.com/package/@struktos/core)** - Core platform
- **[@struktos/adapter-express](https://www.npmjs.com/package/@struktos/adapter-express)** - Express adapter
- **[@struktos/adapter-fastify](https://www.npmjs.com/package/@struktos/adapter-fastify)** - Fastify adapter
- **[@struktos/auth](https://www.npmjs.com/package/@struktos/auth)** - Authentication

## 📄 License

MIT © Struktos.js Team