/**
 * @struktos/adapter-grpc - Basic Client Example
 * 
 * Demonstrates gRPC client connecting to a Struktos-powered server.
 * 
 * Run server first: npx tsx examples/basic-server.ts
 * Then run client: npx tsx examples/basic-client.ts
 */

import * as path from 'path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

const PROTO_PATH = path.join(__dirname, '../protos/example.proto');
const SERVER_ADDRESS = 'localhost:50051';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  @struktos/adapter-grpc - Example Client');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Load proto
  const packageDefinition = await protoLoader.load(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });

  const proto = grpc.loadPackageDefinition(packageDefinition) as any;

  // Create clients
  const greeterClient = new proto.example.Greeter(
    SERVER_ADDRESS,
    grpc.credentials.createInsecure()
  );

  const userClient = new proto.example.UserService(
    SERVER_ADDRESS,
    grpc.credentials.createInsecure()
  );

  // Create metadata with trace ID
  const createMetadata = () => {
    const metadata = new grpc.Metadata();
    metadata.set('x-trace-id', `client-${Date.now()}`);
    metadata.set('authorization', 'Bearer valid-token');
    return metadata;
  };

  // ==================== Test Calls ====================

  console.log('📞 Making gRPC calls...\n');

  // 1. Unary call - SayHello
  console.log('--- Test 1: Unary Call (SayHello) ---');
  await new Promise<void>((resolve) => {
    greeterClient.SayHello(
      { name: 'World' },
      createMetadata(),
      (error: any, response: any) => {
        if (error) {
          console.log('Error:', error.message);
        } else {
          console.log('Response:', response);
        }
        resolve();
      }
    );
  });

  // 2. Server streaming - SayHelloStream
  console.log('\n--- Test 2: Server Streaming (SayHelloStream) ---');
  await new Promise<void>((resolve) => {
    const stream = greeterClient.SayHelloStream(
      { name: 'Struktos' },
      createMetadata()
    );

    stream.on('data', (response: any) => {
      console.log('Stream response:', response.message);
    });

    stream.on('end', () => {
      console.log('Stream ended');
      resolve();
    });

    stream.on('error', (error: any) => {
      console.log('Stream error:', error.message);
      resolve();
    });
  });

  // 3. Client streaming - SayHelloMany
  console.log('\n--- Test 3: Client Streaming (SayHelloMany) ---');
  await new Promise<void>((resolve) => {
    const stream = greeterClient.SayHelloMany(createMetadata(), (error: any, response: any) => {
      if (error) {
        console.log('Error:', error.message);
      } else {
        console.log('Response:', response);
      }
      resolve();
    });

    const names = ['Alice', 'Bob', 'Charlie'];
    names.forEach((name) => {
      stream.write({ name });
    });
    stream.end();
  });

  // 4. Bidirectional streaming - SayHelloChat
  console.log('\n--- Test 4: Bidirectional Streaming (SayHelloChat) ---');
  await new Promise<void>((resolve) => {
    const stream = greeterClient.SayHelloChat(createMetadata());

    stream.on('data', (response: any) => {
      console.log('Chat response:', response.message);
    });

    stream.on('end', () => {
      console.log('Chat ended');
      resolve();
    });

    // Send some messages
    const names = ['David', 'Eve'];
    names.forEach((name, i) => {
      setTimeout(() => {
        stream.write({ name });
        if (i === names.length - 1) {
          setTimeout(() => stream.end(), 500);
        }
      }, i * 500);
    });
  });

  // 5. User service - GetUser
  console.log('\n--- Test 5: GetUser ---');
  await new Promise<void>((resolve) => {
    userClient.GetUser(
      { id: 'user-123' },
      createMetadata(),
      (error: any, response: any) => {
        if (error) {
          console.log('Error:', error.message);
        } else {
          console.log('User:', response);
        }
        resolve();
      }
    );
  });

  // 6. User service - CreateUser
  console.log('\n--- Test 6: CreateUser ---');
  await new Promise<void>((resolve) => {
    userClient.CreateUser(
      { name: 'Jane Doe', email: 'jane@example.com' },
      createMetadata(),
      (error: any, response: any) => {
        if (error) {
          console.log('Error:', error.message);
        } else {
          console.log('Created User:', response);
        }
        resolve();
      }
    );
  });

  // 7. User service - ListUsers
  console.log('\n--- Test 7: ListUsers ---');
  await new Promise<void>((resolve) => {
    userClient.ListUsers(
      { page_size: 3 },
      createMetadata(),
      (error: any, response: any) => {
        if (error) {
          console.log('Error:', error.message);
        } else {
          console.log('Users:', response.users);
        }
        resolve();
      }
    );
  });

  // 8. Error handling - GetUser with invalid ID
  console.log('\n--- Test 8: Error Handling (GetUser with invalid ID) ---');
  await new Promise<void>((resolve) => {
    userClient.GetUser(
      { id: 'invalid-id' },
      createMetadata(),
      (error: any, response: any) => {
        if (error) {
          console.log('Expected Error:', error.details);
        } else {
          console.log('User:', response);
        }
        resolve();
      }
    );
  });

  // 9. Deadline/timeout example
  console.log('\n--- Test 9: With Deadline ---');
  await new Promise<void>((resolve) => {
    const deadline = new Date(Date.now() + 5000); // 5 second deadline
    
    greeterClient.SayHello(
      { name: 'Deadline Test' },
      createMetadata(),
      { deadline },
      (error: any, response: any) => {
        if (error) {
          console.log('Error:', error.message);
        } else {
          console.log('Response within deadline:', response.message);
        }
        resolve();
      }
    );
  });

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  All tests completed!');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Close clients
  greeterClient.close();
  userClient.close();
}

// Run
main().catch(console.error);