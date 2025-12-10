/**
 * @struktos/adapter-grpc - Main Adapter
 * 
 * GrpcStruktosAdapter - Implements IAdapter for gRPC protocol.
 * Integrates Struktos middleware pipeline with gRPC server.
 */

import {
  Server,
  ServerCredentials,
  ServiceDefinition,
  UntypedServiceImplementation,
  Metadata,
} from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import {
  IGrpcAdapter,
  ServerInfo,
  IStruktosMiddleware,
  MiddlewareContext,
  RequestContext,
  StruktosRequest,
  StruktosResponse,
  HttpStatus,
} from '@struktos/core';
import {
  GrpcContextData,
  GrpcAdapterOptions,
  GrpcServiceDefinition,
  MethodDefinition,
  ProtoLoaderOptions,
  ServingStatus,
} from '../types';
import { StruktosInterceptor } from '../interceptors/struktos-interceptor';
import { generateTraceId } from '../utils/id-generator';

/**
 * Default proto loader options
 */
const DEFAULT_PROTO_OPTIONS: ProtoLoaderOptions = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
};

/**
 * GrpcStruktosAdapter - gRPC adapter for Struktos.js
 * 
 * Implements the IGrpcAdapter interface to integrate gRPC with Struktos
 * middleware pipeline and context propagation.
 * 
 * @example
 * ```typescript
 * const adapter = new GrpcStruktosAdapter({
 *   enableCancellation: true,
 *   enableLogging: true,
 * });
 * 
 * adapter.addProtoService('./protos/greeter.proto', 'greeter.Greeter', {
 *   sayHello: (call, callback) => {
 *     const ctx = RequestContext.current();
 *     callback(null, { message: `Hello ${call.request.name}!` });
 *   }
 * });
 * 
 * await adapter.start(50051);
 * ```
 */
export class GrpcStruktosAdapter implements IGrpcAdapter<GrpcContextData> {
  readonly name: string;
  readonly protocol = 'grpc' as const;

  private server: Server | null = null;
  private running = false;
  private services: Map<string, GrpcServiceDefinition> = new Map();
  private methodDefinitions: Map<string, Map<string, MethodDefinition>> = new Map();
  private interceptor: StruktosInterceptor | null = null;
  private credentials: ServerCredentials;
  private healthStatus: Map<string, ServingStatus> = new Map();

  constructor(private readonly options: GrpcAdapterOptions = {}) {
    this.name = options.name ?? 'grpc-adapter';
    this.credentials = options.credentials ?? ServerCredentials.createInsecure();

    // Initialize health check for empty service (overall health)
    this.healthStatus.set('', ServingStatus.SERVING);
  }

  // ==================== IAdapter Implementation ====================

  /**
   * Initialize adapter with middleware pipeline
   */
  async init(middlewares: IStruktosMiddleware<GrpcContextData>[]): Promise<void> {
    this.interceptor = new StruktosInterceptor(middlewares, this.options);
    await this.onInit?.();
  }

  /**
   * Start the gRPC server
   */
  async start(port?: number, host?: string): Promise<ServerInfo> {
    if (this.running) {
      throw new Error('gRPC server is already running');
    }

    await this.onBeforeStart?.();

    const actualPort = port ?? 50051;
    const actualHost = host ?? '0.0.0.0';
    const address = `${actualHost}:${actualPort}`;

    // Create server with options
    this.server = new Server(this.options.serverOptions);

    // Add all registered services
    for (const [serviceName, service] of this.services) {
      const methodDefs = this.methodDefinitions.get(serviceName);
      
      // Wrap implementation with interceptor
      const wrappedImpl = this.interceptor
        ? this.interceptor.wrapService(serviceName, service.implementation, methodDefs!)
        : service.implementation;

      this.server.addService(service.definition, wrappedImpl);
    }

    // Add health check service if enabled
    if (this.options.serverOptions?.['grpc.health_check_enabled'] !== false) {
      this.addHealthCheckService();
    }

    // Bind and start server
    return new Promise((resolve, reject) => {
      this.server!.bindAsync(address, this.credentials, (error, boundPort) => {
        if (error) {
          reject(error);
          return;
        }

        this.running = true;

        this.onAfterStart?.();

        resolve({
          protocol: 'grpc',
          host: actualHost,
          port: boundPort,
          url: `grpc://${actualHost}:${boundPort}`,
          metadata: {
            services: Array.from(this.services.keys()),
          },
        });
      });
    });
  }

  /**
   * Stop the gRPC server
   */
  async stop(): Promise<void> {
    if (!this.running || !this.server) {
      return;
    }

    await this.onBeforeStop?.();

    return new Promise((resolve) => {
      this.server!.tryShutdown(() => {
        this.running = false;
        this.server = null;
        this.onAfterStop?.();
        resolve();
      });
    });
  }

  /**
   * Check if server is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get the underlying gRPC server
   */
  getServer(): Server | null {
    return this.server;
  }

  /**
   * Transform raw gRPC call to StruktosRequest
   */
  transformRequest(raw: any): StruktosRequest {
    const metadata = raw.metadata as Metadata || new Metadata();
    const path = raw.path || '/unknown/method';
    const [, serviceName, methodName] = path.split('/');

    return {
      id: generateTraceId(),
      method: 'POST',
      path,
      headers: this.metadataToHeaders(metadata),
      query: {},
      params: {
        service: serviceName || '',
        method: methodName || '',
      },
      body: raw.request,
      ip: raw.getPeer?.(),
      protocol: 'grpc',
      raw,
    };
  }

  /**
   * Transform StruktosResponse to gRPC response
   */
  transformResponse(response: StruktosResponse, raw: any): void {
    // gRPC responses are handled through callbacks
    // This method is mainly for setting trailing metadata
    if (raw.sendMetadata && response.headers) {
      const metadata = new Metadata();
      for (const [key, value] of Object.entries(response.headers)) {
        if (value) {
          metadata.set(key, String(value));
        }
      }
      raw.sendMetadata(metadata);
    }
  }

  /**
   * Create middleware context from raw gRPC call
   */
  createContext(raw: any): MiddlewareContext<GrpcContextData> {
    const request = this.transformRequest(raw);
    const context = RequestContext.current<GrpcContextData>();

    if (!context) {
      throw new Error('No active RequestContext');
    }

    return {
      context,
      request,
      response: {
        status: HttpStatus.OK,
        headers: {},
      },
      items: new Map(),
    };
  }

  // ==================== IGrpcAdapter Implementation ====================

  /**
   * Add a gRPC service with definition
   */
  addService(definition: ServiceDefinition, implementation: UntypedServiceImplementation): void {
    // Extract service name from definition
    const serviceName = this.extractServiceName(definition);
    
    this.services.set(serviceName, { definition, implementation });
    this.methodDefinitions.set(serviceName, this.extractMethodDefinitions(serviceName, definition));
    this.healthStatus.set(serviceName, ServingStatus.SERVING);
  }

  /**
   * Get server credentials
   */
  getCredentials(): ServerCredentials {
    return this.credentials;
  }

  // ==================== Extended Methods ====================

  /**
   * Load and add a service from proto file
   */
  async addProtoService(
    protoPath: string,
    servicePath: string,
    implementation: UntypedServiceImplementation,
    loaderOptions?: ProtoLoaderOptions
  ): Promise<void> {
    const packageDefinition = await protoLoader.load(protoPath, {
      ...DEFAULT_PROTO_OPTIONS,
      ...loaderOptions,
    });

    // Navigate to the service definition
    const parts = servicePath.split('.');
    let current: any = packageDefinition;
    
    for (const part of parts) {
      current = current[part];
      if (!current) {
        throw new Error(`Service not found: ${servicePath}`);
      }
    }

    if (!current.service) {
      throw new Error(`Invalid service definition: ${servicePath}`);
    }

    this.addService(current.service, implementation);
  }

  /**
   * Add multiple services from a proto package
   */
  async loadProtoPackage(
    protoPath: string,
    implementations: Record<string, UntypedServiceImplementation>,
    loaderOptions?: ProtoLoaderOptions
  ): Promise<void> {
    const packageDefinition = await protoLoader.load(protoPath, {
      ...DEFAULT_PROTO_OPTIONS,
      ...loaderOptions,
    });

    for (const [servicePath, implementation] of Object.entries(implementations)) {
      const parts = servicePath.split('.');
      let current: any = packageDefinition;
      
      for (const part of parts) {
        current = current[part];
      }

      if (current?.service) {
        this.addService(current.service, implementation);
      }
    }
  }

  /**
   * Set health status for a service
   */
  setHealthStatus(serviceName: string, status: ServingStatus): void {
    this.healthStatus.set(serviceName, status);
  }

  /**
   * Get health status for a service
   */
  getHealthStatus(serviceName: string = ''): ServingStatus {
    return this.healthStatus.get(serviceName) ?? ServingStatus.SERVICE_UNKNOWN;
  }

  // ==================== Private Methods ====================

  /**
   * Extract service name from definition
   */
  private extractServiceName(definition: ServiceDefinition): string {
    // Try to get name from first method's path
    for (const method of Object.values(definition)) {
      if (method && typeof (method as any).path === 'string') {
        const path = (method as any).path as string;
        const parts = path.split('/');
        if (parts.length >= 2) {
          return parts[1];
        }
      }
    }
    return `service_${Date.now()}`;
  }

  /**
   * Extract method definitions from service definition
   */
  private extractMethodDefinitions(
    serviceName: string,
    definition: ServiceDefinition
  ): Map<string, MethodDefinition> {
    const methods = new Map<string, MethodDefinition>();

    for (const [methodName, method] of Object.entries(definition)) {
      const methodDef = method as any;
      methods.set(methodName, {
        service: serviceName,
        method: methodName,
        path: methodDef.path || `/${serviceName}/${methodName}`,
        requestStream: methodDef.requestStream || false,
        responseStream: methodDef.responseStream || false,
      });
    }

    return methods;
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
   * Add gRPC health check service
   */
  private addHealthCheckService(): void {
    // Note: In production, you'd load the official health.proto
    // This is a placeholder - actual health check service would need proto definition
    console.log('[GrpcAdapter] Health check service enabled (stub)');
    
    // Store health check handlers for potential future use
    this.healthStatus.set('__health_check_enabled__', ServingStatus.SERVING);
  }

  // ==================== Lifecycle Hooks ====================

  async onInit?(): Promise<void>;
  async onBeforeStart?(): Promise<void>;
  async onAfterStart?(): Promise<void>;
  async onBeforeStop?(): Promise<void>;
  async onAfterStop?(): Promise<void>;
}

/**
 * Create a new gRPC adapter
 */
export function createGrpcAdapter(options?: GrpcAdapterOptions): GrpcStruktosAdapter {
  return new GrpcStruktosAdapter(options);
}