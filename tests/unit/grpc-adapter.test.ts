/**
 * Unit Tests - GrpcStruktosAdapter
 */

import { ServerCredentials, Metadata } from '@grpc/grpc-js';
import { GrpcStruktosAdapter, createGrpcAdapter } from '../../src/adapter/grpc-adapter';
import { ServingStatus } from '../../src/types';

describe('GrpcStruktosAdapter', () => {
  let adapter: GrpcStruktosAdapter;

  beforeEach(() => {
    adapter = new GrpcStruktosAdapter();
  });

  afterEach(async () => {
    if (adapter.isRunning()) {
      await adapter.stop();
    }
  });

  describe('constructor', () => {
    it('should create adapter with default options', () => {
      expect(adapter.name).toBe('grpc-adapter');
      expect(adapter.protocol).toBe('grpc');
      expect(adapter.isRunning()).toBe(false);
    });

    it('should create adapter with custom name', () => {
      const customAdapter = new GrpcStruktosAdapter({ name: 'custom-grpc' });
      expect(customAdapter.name).toBe('custom-grpc');
    });

    it('should create adapter using factory function', () => {
      const factoryAdapter = createGrpcAdapter({ name: 'factory-adapter' });
      expect(factoryAdapter.name).toBe('factory-adapter');
      expect(factoryAdapter.protocol).toBe('grpc');
    });
  });

  describe('init', () => {
    it('should initialize with empty middleware array', async () => {
      await adapter.init([]);
      // Should not throw
    });

    it('should initialize with middleware array', async () => {
      const middleware = {
        invoke: jest.fn().mockImplementation(async (_ctx, next) => await next()),
      };
      
      await adapter.init([middleware]);
      // Should not throw
    });

    it('should call onInit lifecycle hook', async () => {
      const onInit = jest.fn();
      const customAdapter = new GrpcStruktosAdapter();
      customAdapter.onInit = onInit;
      
      await customAdapter.init([]);
      
      expect(onInit).toHaveBeenCalled();
    });
  });

  describe('getServer', () => {
    it('should return null before start', () => {
      expect(adapter.getServer()).toBeNull();
    });
  });

  describe('isRunning', () => {
    it('should return false before start', () => {
      expect(adapter.isRunning()).toBe(false);
    });
  });

  describe('getCredentials', () => {
    it('should return insecure credentials by default', () => {
      const credentials = adapter.getCredentials();
      expect(credentials).toBeDefined();
    });

    it('should return custom credentials when provided', () => {
      const customCredentials = ServerCredentials.createInsecure();
      const customAdapter = new GrpcStruktosAdapter({
        credentials: customCredentials,
      });
      
      expect(customAdapter.getCredentials()).toBe(customCredentials);
    });
  });

  describe('health status', () => {
    it('should have default SERVING status', () => {
      expect(adapter.getHealthStatus()).toBe(ServingStatus.SERVING);
    });

    it('should set and get health status for service', () => {
      adapter.setHealthStatus('test.Service', ServingStatus.NOT_SERVING);
      expect(adapter.getHealthStatus('test.Service')).toBe(ServingStatus.NOT_SERVING);
    });

    it('should return SERVICE_UNKNOWN for unregistered service', () => {
      expect(adapter.getHealthStatus('unknown.Service')).toBe(ServingStatus.SERVICE_UNKNOWN);
    });
  });

  describe('transformRequest', () => {
    it('should transform raw call to StruktosRequest', () => {
      const metadata = new Metadata();
      metadata.set('x-trace-id', 'trace-123');
      
      const rawCall = {
        metadata,
        request: { name: 'test' },
        path: '/example.Greeter/SayHello',
        getPeer: () => '127.0.0.1:12345',
      };

      const request = adapter.transformRequest(rawCall);

      expect(request.method).toBe('POST');
      expect(request.path).toBe('/example.Greeter/SayHello');
      expect(request.protocol).toBe('grpc');
      expect(request.body).toEqual({ name: 'test' });
      expect(request.params.service).toBe('example.Greeter');
      expect(request.params.method).toBe('SayHello');
    });

    it('should handle missing metadata', () => {
      const rawCall = {
        request: { name: 'test' },
        path: '/Service/Method',
      };

      const request = adapter.transformRequest(rawCall);
      expect(request.headers).toEqual({});
    });
  });

  describe('addService', () => {
    it('should add service definition', () => {
      const mockDefinition = {
        SayHello: {
          path: '/example.Greeter/SayHello',
          requestStream: false,
          responseStream: false,
        },
      };

      const mockImplementation = {
        SayHello: jest.fn(),
      };

      adapter.addService(mockDefinition as any, mockImplementation);
      
      // Service should be registered
      expect(adapter.getHealthStatus('example.Greeter')).toBe(ServingStatus.SERVING);
    });
  });
});

describe('GrpcStruktosAdapter Integration', () => {
  let adapter: GrpcStruktosAdapter;

  beforeEach(async () => {
    adapter = new GrpcStruktosAdapter();
    await adapter.init([]);
  });

  afterEach(async () => {
    if (adapter.isRunning()) {
      await adapter.stop();
    }
  });

  describe('start and stop', () => {
    it('should start server on specified port', async () => {
      const serverInfo = await adapter.start(50052, '127.0.0.1');

      expect(serverInfo.protocol).toBe('grpc');
      expect(serverInfo.host).toBe('127.0.0.1');
      expect(serverInfo.port).toBe(50052);
      expect(serverInfo.url).toBe('grpc://127.0.0.1:50052');
      expect(adapter.isRunning()).toBe(true);
    });

    it('should stop server', async () => {
      await adapter.start(50053, '127.0.0.1');
      expect(adapter.isRunning()).toBe(true);

      await adapter.stop();
      expect(adapter.isRunning()).toBe(false);
    });

    it('should throw error when starting already running server', async () => {
      await adapter.start(50054, '127.0.0.1');

      await expect(adapter.start(50055, '127.0.0.1')).rejects.toThrow(
        'gRPC server is already running'
      );
    });

    it('should not throw when stopping non-running server', async () => {
      await adapter.stop(); // Should not throw
      expect(adapter.isRunning()).toBe(false);
    });

    it('should call lifecycle hooks', async () => {
      const onBeforeStart = jest.fn();
      const onAfterStart = jest.fn();
      const onBeforeStop = jest.fn();
      const onAfterStop = jest.fn();

      adapter.onBeforeStart = onBeforeStart;
      adapter.onAfterStart = onAfterStart;
      adapter.onBeforeStop = onBeforeStop;
      adapter.onAfterStop = onAfterStop;

      await adapter.start(50056, '127.0.0.1');
      expect(onBeforeStart).toHaveBeenCalled();
      expect(onAfterStart).toHaveBeenCalled();

      await adapter.stop();
      expect(onBeforeStop).toHaveBeenCalled();
      expect(onAfterStop).toHaveBeenCalled();
    });
  });
});