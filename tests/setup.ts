/**
 * Jest Test Setup
 * 
 * This file runs before each test file
 */

// Increase timeout for integration tests
jest.setTimeout(30000);

// Mock console.log in tests to reduce noise (optional)
// global.console = {
//   ...console,
//   log: jest.fn(),
//   debug: jest.fn(),
//   info: jest.fn(),
// };

// Clean up after all tests
afterAll(async () => {
  // Allow pending operations to complete
  await new Promise(resolve => setTimeout(resolve, 100));
});