/**
 * Unit Tests - ID Generator
 */

import {
  generateTraceId,
  generateRequestId,
  generateShortId,
  generateUUID,
  parseTraceId,
} from '../../src/utils/id-generator';

describe('ID Generator', () => {
  describe('generateTraceId', () => {
    it('should generate a trace ID with grpc prefix', () => {
      const traceId = generateTraceId();
      expect(traceId).toMatch(/^grpc-[a-z0-9]+-[a-z0-9]+$/);
    });

    it('should generate unique trace IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateTraceId());
      }
      expect(ids.size).toBe(100);
    });

    it('should include timestamp in trace ID', () => {
      const before = Date.now();
      const traceId = generateTraceId();
      const after = Date.now();
      
      const parsed = parseTraceId(traceId);
      expect(parsed.timestamp).toBeDefined();
      expect(parsed.timestamp).toBeGreaterThanOrEqual(before);
      expect(parsed.timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('generateRequestId', () => {
    it('should generate a request ID with req prefix', () => {
      const requestId = generateRequestId();
      expect(requestId).toMatch(/^req-[a-z0-9]+-[a-z0-9]+$/);
    });

    it('should generate unique request IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateRequestId());
      }
      expect(ids.size).toBe(100);
    });
  });

  describe('generateShortId', () => {
    it('should generate a short alphanumeric ID', () => {
      const shortId = generateShortId();
      expect(shortId).toMatch(/^[a-z0-9]+$/);
      expect(shortId.length).toBeGreaterThanOrEqual(4);
      expect(shortId.length).toBeLessThanOrEqual(10);
    });
  });

  describe('generateUUID', () => {
    it('should generate a valid UUID v4 format', () => {
      const uuid = generateUUID();
      expect(uuid).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      );
    });

    it('should generate unique UUIDs', () => {
      const uuids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        uuids.add(generateUUID());
      }
      expect(uuids.size).toBe(100);
    });
  });

  describe('parseTraceId', () => {
    it('should parse a valid trace ID', () => {
      const traceId = generateTraceId();
      const parsed = parseTraceId(traceId);
      
      expect(parsed.type).toBe('grpc');
      expect(parsed.timestamp).toBeDefined();
      expect(typeof parsed.timestamp).toBe('number');
    });

    it('should return empty object for invalid trace ID', () => {
      const parsed = parseTraceId('invalid');
      expect(parsed.timestamp).toBeUndefined();
    });

    it('should handle trace IDs with different prefixes', () => {
      const parsed = parseTraceId('http-abc123-xyz');
      expect(parsed.type).toBe('http');
    });
  });
});