/**
 * @struktos/adapter-grpc - Basic Server Example
 * 
 * Demonstrates gRPC server with Struktos middleware integration.
 * 
 * Run: npx tsx examples/basic-server.ts
 */

import * as path from 'path';
import {
  createGrpcAdapter,
  createLoggingInterceptor,
  createTimeoutInterceptor,
  GrpcContextData,
} from '../src';
import {
  StruktosApp,
  RequestContext,
  createMiddleware,
  BadRequestException,
} from '@struktos/core';

// ==================== Custom Middleware ====================

/**
 * Authentication middleware - validates authorization header
 */
const authMiddleware = createMiddleware<GrpcContextData>(async (ctx, next) => {
  const authHeader = ctx.request.headers['authorization'];
  
  if (authHeader && typeof authHeader === 'string') {
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      // In production, validate token properly
      if (token === 'valid-token') {
        ctx.context.set('userId', 'user-123');
        ctx.context.set('user', { id: 'user-123', name: 'John Doe' });
      }
    }
  }
  
  await next();
});

/**
 * Validation middleware - validates request payload
 */
const validationMiddleware = createMiddleware<GrpcContextData>(async (ctx, next) => {
  const method = ctx.request.params.method;
  const body = ctx.request.body as any;

  // Example validation for SayHello
  if (method === 'SayHello' && !body?.name) {
    throw new BadRequestException('Name is required');
  }

  await next();
});

// ==================== Service Implementations ====================

/**
 * Greeter service implementation
 */
const greeterService = {
  SayHello: (call: any, callback: any) => {
    const ctx = RequestContext.current<GrpcContextData>();
    const traceId = ctx?.get('traceId') || 'unknown';
    const userId = ctx?.get('userId');

    const { name } = call.request;

    console.log(`[SayHello] Processing request for: ${name}`);
    console.log(`[SayHello] TraceID: ${traceId}`);
    console.log(`[SayHello] UserID: ${userId || 'anonymous'}`);

    // Check for cancellation
    if (ctx?.isCancelled()) {
      callback({ code: 1, details: 'Request cancelled' }, null);
      return;
    }

    callback(null, {
      message: `Hello, ${name}!`,
      trace_id: traceId,
      timestamp: Date.now(),
    });
  },

  SayHelloStream: (call: any) => {
    const ctx = RequestContext.current<GrpcContextData>();
    const traceId = ctx?.get('traceId') || 'unknown';
    const { name } = call.request;

    console.log(`[SayHelloStream] Starting stream for: ${name}`);

    // Send multiple responses
    const greetings = ['Hello', 'Hola', 'Bonjour', 'Ciao', '안녕하세요'];
    let index = 0;

    const sendGreeting = () => {
      if (index >= greetings.length || call.cancelled) {
        call.end();
        return;
      }

      call.write({
        message: `${greetings[index]}, ${name}!`,
        trace_id: traceId,
        timestamp: Date.now(),
      });

      index++;
      setTimeout(sendGreeting, 500);
    };

    sendGreeting();
  },

  SayHelloMany: (call: any, callback: any) => {
    const ctx = RequestContext.current<GrpcContextData>();
    const traceId = ctx?.get('traceId') || 'unknown';
    const names: string[] = [];

    call.on('data', (data: any) => {
      names.push(data.name);
    });

    call.on('end', () => {
      callback(null, {
        message: `Hello to all: ${names.join(', ')}!`,
        trace_id: traceId,
        timestamp: Date.now(),
      });
    });
  },

  SayHelloChat: (call: any) => {
    const ctx = RequestContext.current<GrpcContextData>();
    const traceId = ctx?.get('traceId') || 'unknown';

    call.on('data', (data: any) => {
      if (!call.cancelled) {
        call.write({
          message: `Echo: Hello, ${data.name}!`,
          trace_id: traceId,
          timestamp: Date.now(),
        });
      }
    });

    call.on('end', () => {
      call.end();
    });
  },
};

/**
 * User service implementation
 */
const userService = {
  GetUser: (call: any, callback: any) => {
    const ctx = RequestContext.current<GrpcContextData>();
    const traceId = ctx?.get('traceId');
    const { id } = call.request;

    console.log(`[GetUser] Fetching user: ${id}, trace: ${traceId}`);

    // Simulated user lookup
    if (id === 'user-123') {
      callback(null, {
        id: 'user-123',
        name: 'John Doe',
        email: 'john@example.com',
        created_at: Date.now() - 86400000,
      });
    } else {
      callback({ code: 5, details: 'User not found' }, null);
    }
  },

  CreateUser: (call: any, callback: any) => {
    const { name, email } = call.request;

    // Simulated user creation
    const newUser = {
      id: `user-${Date.now()}`,
      name,
      email,
      created_at: Date.now(),
    };

    console.log(`[CreateUser] Created user: ${newUser.id}`);
    callback(null, newUser);
  },

  ListUsers: (call: any, callback: any) => {
    const { page_size = 10 } = call.request;

    // Simulated user list
    const users = Array.from({ length: Math.min(page_size, 5) }, (_, i) => ({
      id: `user-${i + 1}`,
      name: `User ${i + 1}`,
      email: `user${i + 1}@example.com`,
      created_at: Date.now() - i * 86400000,
    }));

    callback(null, {
      users,
      next_page_token: '',
    });
  },

  DeleteUser: (call: any, callback: any) => {
    const { id } = call.request;

    console.log(`[DeleteUser] Deleting user: ${id}`);

    callback(null, {
      success: true,
      message: `User ${id} deleted successfully`,
    });
  },
};

// ==================== Main ====================

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  @struktos/adapter-grpc - Example Server');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Create Struktos app
  const app = StruktosApp.create<GrpcContextData>({
    name: 'grpc-example-server',
    useDefaultErrorHandler: true,
  });

  // Add middlewares
  app
    .use(createLoggingInterceptor({ logRequests: true, logResponses: true }))
    .use(createTimeoutInterceptor(30000)) // 30 second timeout
    .use(authMiddleware)
    .use(validationMiddleware);

  // Create gRPC adapter
  const adapter = createGrpcAdapter({
    name: 'example-grpc',
    enableCancellation: true,
    enableLogging: true,
    onContextCreated: (ctx, _call) => {
      console.log(`[Context] Created for ${ctx.methodPath}`);
    },
    onRequestComplete: (ctx, duration) => {
      console.log(`[Context] Completed ${ctx.methodPath} in ${duration}ms`);
    },
  });

  // Load proto and add services
  const protoPath = path.join(__dirname, '../protos/example.proto');
  
  try {
    await adapter.addProtoService(protoPath, 'example.Greeter', greeterService);
    await adapter.addProtoService(protoPath, 'example.UserService', userService);
  } catch (error) {
    console.error('Failed to load proto:', error);
    // Continue without proto for demo purposes
  }

  // Start server
  const serverInfo = await app.listen(adapter, 50051);

  console.log(`\n🚀 gRPC Server started!`);
  console.log(`   Address: ${serverInfo.url}`);
  console.log(`   Services: Greeter, UserService\n`);
  console.log('Press Ctrl+C to stop\n');

  // Handle shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await app.stop();
    console.log('Server stopped');
    process.exit(0);
  });
}

// Run
main().catch(console.error);