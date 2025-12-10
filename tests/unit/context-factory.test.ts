/**
 * Unit Tests - Context Factory
 */

import { Metadata } from '@grpc/grpc-js';
import { GrpcContextFactory } from '../../src/context/factory';
import { MethodDefinition } from '../../src/types';

// Mock gRPC call
function createMockCall(options: {
  metadata?: Metadata;
  request?: any;
  peer?: string;
  deadline?: Date | number;
} = {}) {
  const metadata = options.metadata || new Metadata();
  
  return {
    metadata,
    request: options.request || {},
    getPeer: () => options.peer || '127.0.0.1:12345',
    getDeadline: () => options.deadline,
    on: jest.fn(),
    cancelled: false,
  };
}

// Mock method definition
const mockMethodDef: MethodDefinition = {
  service: 'example.Greeter',
  method: 'SayHello',
  path: '/example.Greeter/SayHello',
  requestStream: false,
  responseStream: false,
};

describe('GrpcContextFactory', () => {
  let factory: GrpcContextFactory;

  beforeEach(() => {
    factory = new GrpcContextFactory();
  });

  describe('createContext', () => {
    it('should create context with default trace ID', () => {
      const call = createMockCall();
      const context = factory.createContext(call as any, mockMethodDef);

      expect(context.traceId).toBeDefined();
      expect(context.traceId).toMatch(/^grpc-/);
    });

    it('should extract trace ID from metadata', () => {
      const metadata = new Metadata();
      metadata.set('x-trace-id', 'custom-trace-123');
      
      const call = createMockCall({ metadata });
      const context = factory.createContext(call as any, mockMethodDef);

      expect(context.traceId).toBe('custom-trace-123');
    });

    it('should extract request ID from metadata', () => {
      const metadata = new Metadata();
      metadata.set('x-request-id', 'req-456');
      
      const call = createMockCall({ metadata });
      const context = factory.createContext(call as any, mockMethodDef);

      expect(context.requestId).toBe('req-456');
    });

    it('should extract user ID from metadata', () => {
      const metadata = new Metadata();
      metadata.set('x-user-id', 'user-789');
      
      const call = createMockCall({ metadata });
      const context = factory.createContext(call as any, mockMethodDef);

      expect(context.userId).toBe('user-789');
    });

    it('should include service and method names', () => {
      const call = createMockCall();
      const context = factory.createContext(call as any, mockMethodDef);

      expect(context.serviceName).toBe('example.Greeter');
      expect(context.methodName).toBe('SayHello');
      expect(context.methodPath).toBe('/example.Greeter/SayHello');
    });

    it('should detect unary call type', () => {
      const call = createMockCall();
      const context = factory.createContext(call as any, mockMethodDef);

      expect(context.callType).toBe('unary');
    });

    it('should detect server-streaming call type', () => {
      const streamingMethodDef: MethodDefinition = {
        ...mockMethodDef,
        responseStream: true,
      };
      
      const call = createMockCall();
      const context = factory.createContext(call as any, streamingMethodDef);

      expect(context.callType).toBe('server-streaming');
    });

    it('should detect client-streaming call type', () => {
      const streamingMethodDef: MethodDefinition = {
        ...mockMethodDef,
        requestStream: true,
      };
      
      const call = createMockCall();
      const context = factory.createContext(call as any, streamingMethodDef);

      expect(context.callType).toBe('client-streaming');
    });

    it('should detect bidirectional streaming call type', () => {
      const streamingMethodDef: MethodDefinition = {
        ...mockMethodDef,
        requestStream: true,
        responseStream: true,
      };
      
      const call = createMockCall();
      const context = factory.createContext(call as any, streamingMethodDef);

      expect(context.callType).toBe('bidirectional');
    });

    it('should include peer address', () => {
      const call = createMockCall({ peer: '192.168.1.100:54321' });
      const context = factory.createContext(call as any, mockMethodDef);

      expect(context.peer).toBe('192.168.1.100:54321');
    });

    it('should include deadline when set', () => {
      const deadline = new Date(Date.now() + 5000);
      const call = createMockCall({ deadline });
      const context = factory.createContext(call as any, mockMethodDef);

      expect(context.deadline).toEqual(deadline);
    });

    it('should convert numeric deadline to Date', () => {
      const deadline = Date.now() + 5000;
      const call = createMockCall({ deadline });
      const context = factory.createContext(call as any, mockMethodDef);

      expect(context.deadline).toBeInstanceOf(Date);
      expect(context.deadline?.getTime()).toBe(deadline);
    });

    it('should include timestamp', () => {
      const before = Date.now();
      const call = createMockCall();
      const context = factory.createContext(call as any, mockMethodDef);
      const after = Date.now();

      expect(context.timestamp).toBeGreaterThanOrEqual(before);
      expect(context.timestamp).toBeLessThanOrEqual(after);
    });

    it('should include metadata as record', () => {
      const metadata = new Metadata();
      metadata.set('custom-header', 'custom-value');
      metadata.set('another-header', 'another-value');
      
      const call = createMockCall({ metadata });
      const context = factory.createContext(call as any, mockMethodDef);

      expect(context.metadata).toBeDefined();
      expect(context.metadata?.['custom-header']).toBe('custom-value');
      expect(context.metadata?.['another-header']).toBe('another-value');
    });
  });

  describe('with custom options', () => {
    it('should use custom trace ID generator', () => {
      const customFactory = new GrpcContextFactory({
        generateTraceId: () => 'custom-generated-trace',
      });

      const call = createMockCall();
      const context = customFactory.createContext(call as any, mockMethodDef);

      expect(context.traceId).toBe('custom-generated-trace');
    });

    it('should use custom request ID generator', () => {
      const customFactory = new GrpcContextFactory({
        generateRequestId: () => 'custom-req-id',
      });

      const call = createMockCall();
      const context = customFactory.createContext(call as any, mockMethodDef);

      expect(context.requestId).toBe('custom-req-id');
    });

    it('should use custom user ID extractor', () => {
      const customFactory = new GrpcContextFactory({
        extractUserId: (metadata) => {
          const auth = metadata.get('authorization')[0];
          return auth ? `extracted-${auth}` : undefined;
        },
      });

      const metadata = new Metadata();
      metadata.set('authorization', 'Bearer token123');
      
      const call = createMockCall({ metadata });
      const context = customFactory.createContext(call as any, mockMethodDef);

      expect(context.userId).toBe('extracted-Bearer token123');
    });

    it('should apply custom metadata transformer', () => {
      const customFactory = new GrpcContextFactory({
        metadataTransformer: (metadata) => ({
          customField: 'custom-value',
          headerCount: Object.keys(metadata.getMap()).length,
        }),
      });

      const metadata = new Metadata();
      metadata.set('header1', 'value1');
      metadata.set('header2', 'value2');
      
      const call = createMockCall({ metadata });
      const context = customFactory.createContext(call as any, mockMethodDef);

      expect((context as any).customField).toBe('custom-value');
      expect((context as any).headerCount).toBe(2);
    });
  });
});