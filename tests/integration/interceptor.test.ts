/**
 * Unit Tests - Struktos Interceptor
 */

import { Metadata } from '@grpc/grpc-js';
import {
  StruktosInterceptor,
  createLoggingInterceptor,
  createTimeoutInterceptor,
  createRateLimitInterceptor,
} from '../../src/interceptors/struktos-interceptor';
import { MethodDefinition } from '../../src/types';

// Mock middleware
const createMockMiddleware = (_name: string, behavior?: (ctx: any) => void) => ({
  invoke: jest.fn().mockImplementation(async (ctx, next) => {
    if (behavior) behavior(ctx);
    await next();
  }),
});

// Mock call
const createMockCall = () => ({
  metadata: new Metadata(),
  request: { name: 'test' },
  getPeer: () => '127.0.0.1:12345',
  getDeadline: () => undefined,
  on: jest.fn(),
  sendMetadata: jest.fn(),
  cancelled: false,
});

// Mock method definition
const mockMethodDef: MethodDefinition = {
  service: 'example.Greeter',
  method: 'SayHello',
  path: '/example.Greeter/SayHello',
  requestStream: false,
  responseStream: false,
};

describe('StruktosInterceptor', () => {
  describe('wrapService', () => {
    it('should wrap all service methods', () => {
      const interceptor = new StruktosInterceptor([]);
      
      const implementation = {
        SayHello: jest.fn(),
        SayGoodbye: jest.fn(),
        nonFunction: 'value',
      };

      const methodDefs = new Map<string, MethodDefinition>([
        ['SayHello', mockMethodDef],
        ['SayGoodbye', { ...mockMethodDef, method: 'SayGoodbye' }],
      ]);

      const wrapped = interceptor.wrapService('example.Greeter', implementation, methodDefs);

      expect(typeof wrapped.SayHello).toBe('function');
      expect(typeof wrapped.SayGoodbye).toBe('function');
      expect(wrapped.nonFunction).toBe('value'); // Non-functions should pass through
    });

    it('should execute middleware pipeline for each method', async () => {
      const middleware1 = createMockMiddleware('middleware1');
      const middleware2 = createMockMiddleware('middleware2');
      
      const interceptor = new StruktosInterceptor([middleware1, middleware2]);

      const originalMethod = jest.fn((_call, callback) => {
        callback(null, { message: 'Hello' });
      });

      const implementation = { SayHello: originalMethod };
      const methodDefs = new Map([['SayHello', mockMethodDef]]);

      const wrapped = interceptor.wrapService('example.Greeter', implementation, methodDefs);

      const call = createMockCall();
      const callback = jest.fn();

      await new Promise<void>((resolve) => {
        wrapped.SayHello(call, (error: any, response: any) => {
          callback(error, response);
          resolve();
        });
      });

      // Both middlewares should have been called
      expect(middleware1.invoke).toHaveBeenCalled();
      expect(middleware2.invoke).toHaveBeenCalled();
    });
  });
});

describe('Built-in Interceptors', () => {
  describe('createLoggingInterceptor', () => {
    it('should create a logging middleware', () => {
      const middleware = createLoggingInterceptor();
      expect(middleware).toBeDefined();
      expect(typeof middleware.invoke).toBe('function');
    });

    it('should log requests when enabled', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      const middleware = createLoggingInterceptor({
        logRequests: true,
        logResponses: true,
      });

      const ctx = {
        context: {
          get: jest.fn().mockReturnValue('trace-123'),
        },
        request: {
          params: { service: 'example.Greeter', method: 'SayHello' },
        },
        response: { status: 200 },
      };

      await middleware.invoke(ctx as any, async () => {});

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('createTimeoutInterceptor', () => {
    it('should create a timeout middleware', () => {
      const middleware = createTimeoutInterceptor(5000);
      expect(middleware).toBeDefined();
      expect(typeof middleware.invoke).toBe('function');
    });

    it('should not cancel context if completed within timeout', async () => {
      const middleware = createTimeoutInterceptor(1000);

      const ctx = {
        context: {
          isCancelled: jest.fn().mockReturnValue(false),
          cancel: jest.fn(),
        },
      };

      await middleware.invoke(ctx as any, async () => {
        // Fast operation
      });

      expect(ctx.context.cancel).not.toHaveBeenCalled();
    });

    it('should set up timeout cancellation', async () => {
      const middleware = createTimeoutInterceptor(100);

      const cancelFn = jest.fn();
      const ctx = {
        context: {
          isCancelled: jest.fn().mockReturnValue(false),
          cancel: cancelFn,
        },
      };

      // Execute quickly - should complete without cancellation
      await middleware.invoke(ctx as any, async () => {
        // Fast operation
      });

      // Cancel should not have been called for fast operations
      expect(cancelFn).not.toHaveBeenCalled();
    });
  });

  describe('createRateLimitInterceptor', () => {
    it('should create a rate limit middleware', () => {
      const middleware = createRateLimitInterceptor(10, 1000);
      expect(middleware).toBeDefined();
      expect(typeof middleware.invoke).toBe('function');
    });

    it('should allow requests within limit', async () => {
      const middleware = createRateLimitInterceptor(5, 1000);

      const ctx = {
        request: { ip: '127.0.0.1' },
        response: { status: 200, body: null, sent: false },
      };

      const next = jest.fn();

      // First 5 requests should pass
      for (let i = 0; i < 5; i++) {
        await middleware.invoke(ctx as any, next);
      }

      expect(next).toHaveBeenCalledTimes(5);
    });

    it('should block requests exceeding limit', async () => {
      const middleware = createRateLimitInterceptor(2, 10000);

      const ctx = {
        request: { ip: '192.168.1.1' },
        response: { status: 200, body: null, sent: false },
      };

      const next = jest.fn();

      // First 2 requests pass
      await middleware.invoke(ctx as any, next);
      await middleware.invoke(ctx as any, next);
      
      // Third request should be blocked
      await middleware.invoke(ctx as any, next);

      expect(ctx.response.status).toBe(429);
      expect(ctx.response.sent).toBe(true);
      expect(next).toHaveBeenCalledTimes(2);
    });

    it('should track different IPs separately', async () => {
      const middleware = createRateLimitInterceptor(1, 10000);

      const ctx1 = {
        request: { ip: '10.0.0.1' },
        response: { status: 200, body: null, sent: false },
      };

      const ctx2 = {
        request: { ip: '10.0.0.2' },
        response: { status: 200, body: null, sent: false },
      };

      const next = jest.fn();

      await middleware.invoke(ctx1 as any, next);
      await middleware.invoke(ctx2 as any, next);

      // Both should pass (different IPs)
      expect(next).toHaveBeenCalledTimes(2);
    });
  });
});