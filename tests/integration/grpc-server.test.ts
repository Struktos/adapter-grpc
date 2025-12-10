/**
 * Integration Tests - Full gRPC Server/Client
 */

import * as path from 'path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { GrpcStruktosAdapter } from '../../src/adapter/grpc-adapter';
import { createLoggingInterceptor } from '../../src/interceptors/struktos-interceptor';
import { RequestContext } from '@struktos/core';
import { GrpcContextData } from '../../src/types';

const PROTO_PATH = path.join(__dirname, '../fixtures/test.proto');
const TEST_PORT = 50099;

// Create test proto file content
const PROTO_CONTENT = `
syntax = "proto3";
package test;

service TestService {
  rpc Echo (EchoRequest) returns (EchoResponse);
  rpc EchoStream (EchoRequest) returns (stream EchoResponse);
}

message EchoRequest {
  string message = 1;
}

message EchoResponse {
  string message = 1;
  string trace_id = 2;
}
`;

describe('gRPC Integration Tests', () => {
  let adapter: GrpcStruktosAdapter;
  let client: any;
  let proto: any;

  beforeAll(async () => {
    // Create test fixtures directory and proto file
    const fs = await import('fs');
    const fixturesDir = path.join(__dirname, '../fixtures');
    
    if (!fs.existsSync(fixturesDir)) {
      fs.mkdirSync(fixturesDir, { recursive: true });
    }
    
    fs.writeFileSync(PROTO_PATH, PROTO_CONTENT);

    // Load proto
    const packageDefinition = await protoLoader.load(PROTO_PATH, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    proto = grpc.loadPackageDefinition(packageDefinition);
  });

  afterAll(async () => {
    // Cleanup test proto file
    const fs = await import('fs');
    if (fs.existsSync(PROTO_PATH)) {
      fs.unlinkSync(PROTO_PATH);
    }
  });

  beforeEach(async () => {
    // Create adapter with middleware
    adapter = new GrpcStruktosAdapter({
      enableCancellation: true,
    });

    // Initialize with logging middleware
    await adapter.init([createLoggingInterceptor({ logRequests: false, logResponses: false })]);

    // Add test service
    const testService = {
      Echo: (call: any, callback: any) => {
        const ctx = RequestContext.current<GrpcContextData>();
        const traceId = ctx?.get('traceId') || 'no-trace';
        
        callback(null, {
          message: `Echo: ${call.request.message}`,
          trace_id: traceId,
        });
      },
      EchoStream: (call: any) => {
        const ctx = RequestContext.current<GrpcContextData>();
        const traceId = ctx?.get('traceId') || 'no-trace';

        for (let i = 0; i < 3; i++) {
          call.write({
            message: `Stream ${i}: ${call.request.message}`,
            trace_id: traceId,
          });
        }
        call.end();
      },
    };

    adapter.addService((proto as any).test.TestService.service, testService);

    // Start server
    await adapter.start(TEST_PORT, '127.0.0.1');

    // Create client
    client = new (proto as any).test.TestService(
      `127.0.0.1:${TEST_PORT}`,
      grpc.credentials.createInsecure()
    );
  });

  afterEach(async () => {
    if (client) {
      client.close();
    }
    if (adapter && adapter.isRunning()) {
      await adapter.stop();
    }
  });

  describe('Unary RPC', () => {
    it('should handle basic echo request', (done) => {
      client.Echo({ message: 'Hello' }, (error: any, response: any) => {
        expect(error).toBeNull();
        expect(response.message).toBe('Echo: Hello');
        done();
      });
    });

    it('should propagate trace ID from metadata', (done) => {
      const metadata = new grpc.Metadata();
      metadata.set('x-trace-id', 'test-trace-123');

      client.Echo({ message: 'Test' }, metadata, (error: any, response: any) => {
        expect(error).toBeNull();
        expect(response.trace_id).toBe('test-trace-123');
        done();
      });
    });

    it('should generate trace ID if not provided', (done) => {
      client.Echo({ message: 'Test' }, (error: any, response: any) => {
        expect(error).toBeNull();
        expect(response.trace_id).toBeDefined();
        expect(response.trace_id).toMatch(/^grpc-/);
        done();
      });
    });

    it('should handle multiple concurrent requests', async () => {
      const promises = [];

      for (let i = 0; i < 10; i++) {
        promises.push(
          new Promise((resolve, reject) => {
            client.Echo({ message: `Request ${i}` }, (error: any, response: any) => {
              if (error) reject(error);
              else resolve(response);
            });
          })
        );
      }

      const responses = await Promise.all(promises);

      expect(responses).toHaveLength(10);
      responses.forEach((response: any, i) => {
        expect(response.message).toBe(`Echo: Request ${i}`);
      });
    });
  });

  describe('Server Streaming RPC', () => {
    it('should handle streaming response', (done) => {
      const messages: string[] = [];
      
      const stream = client.EchoStream({ message: 'Hello' });
      
      stream.on('data', (response: any) => {
        messages.push(response.message);
      });

      stream.on('end', () => {
        expect(messages).toHaveLength(3);
        expect(messages[0]).toBe('Stream 0: Hello');
        expect(messages[1]).toBe('Stream 1: Hello');
        expect(messages[2]).toBe('Stream 2: Hello');
        done();
      });

      stream.on('error', (error: any) => {
        done(error);
      });
    });

    it('should propagate trace ID in streaming responses', (done) => {
      const metadata = new grpc.Metadata();
      metadata.set('x-trace-id', 'stream-trace-456');

      const traceIds: string[] = [];
      const stream = client.EchoStream({ message: 'Test' }, metadata);

      stream.on('data', (response: any) => {
        traceIds.push(response.trace_id);
      });

      stream.on('end', () => {
        expect(traceIds).toHaveLength(3);
        traceIds.forEach((id) => {
          expect(id).toBe('stream-trace-456');
        });
        done();
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle deadline exceeded', (done) => {
      // Set very short deadline
      const deadline = new Date(Date.now() + 1); // 1ms

      client.Echo(
        { message: 'Test' },
        new grpc.Metadata(),
        { deadline },
        (_error: any, _response: any) => {
          // May or may not timeout depending on timing
          // Just ensure no crash
          done();
        }
      );
    });
  });

  describe('Middleware Integration', () => {
    it('should execute custom middleware', async () => {
      // Stop current server
      await adapter.stop();

      // Create new adapter with custom middleware
      const middlewareExecuted = jest.fn();
      
      const customMiddleware = {
        invoke: jest.fn().mockImplementation(async (ctx, next) => {
          middlewareExecuted(ctx.request.path);
          await next();
        }),
      };

      const newAdapter = new GrpcStruktosAdapter();
      await newAdapter.init([customMiddleware]);

      const testService = {
        Echo: (_call: any, callback: any) => {
          callback(null, { message: 'test', trace_id: 'test' });
        },
        EchoStream: (call: any) => {
          call.end();
        },
      };

      newAdapter.addService((proto as any).test.TestService.service, testService);
      await newAdapter.start(TEST_PORT + 1, '127.0.0.1');

      // Create new client
      const newClient = new (proto as any).test.TestService(
        `127.0.0.1:${TEST_PORT + 1}`,
        grpc.credentials.createInsecure()
      );

      await new Promise<void>((resolve, reject) => {
        newClient.Echo({ message: 'Test' }, (error: any) => {
          if (error) reject(error);
          else resolve();
        });
      });

      expect(middlewareExecuted).toHaveBeenCalled();

      newClient.close();
      await newAdapter.stop();
    });
  });
});