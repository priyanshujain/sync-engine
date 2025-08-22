import { SyncRecordValidator } from '../../src/sync/sync-record-validator';
import { SyncRecord } from '../../src/sync/hash-sync-engine';
import { ModelRegistry } from '../../src/model-registry';

// Mock ModelRegistry
jest.mock('../../src/model-registry', () => ({
  ModelRegistry: {
    getModel: jest.fn()
  }
}));

describe('SyncRecordValidator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (ModelRegistry.getModel as jest.Mock).mockReturnValue({}); // Model exists by default
  });

  describe('validate', () => {
    const validRecord: SyncRecord = {
      id: 'sync_123',
      modelName: 'TestModel',
      modelId: 'model_123',
      operation: 'create',
      data: { name: 'Test', value: 123 },
      version: 1,
      timestamp: Date.now(),
      clientId: 'client_123',
      hash: 'abc123def456'
    };

    describe('valid records', () => {
      test('validates a completely valid record', () => {
        const result = SyncRecordValidator.validate(validRecord);
        
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      test('validates update operation', () => {
        const record = { ...validRecord, operation: 'update' as const };
        const result = SyncRecordValidator.validate(record);
        
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      test('validates delete operation without data', () => {
        const record = { ...validRecord, operation: 'delete' as const, data: undefined };
        const result = SyncRecordValidator.validate(record);
        
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      test('validates nested data structures', () => {
        const record = {
          ...validRecord,
          data: {
            name: 'Test',
            nested: {
              level1: {
                level2: {
                  value: 'deep'
                }
              }
            },
            array: [1, 2, 3, { nested: true }]
          }
        };
        
        const result = SyncRecordValidator.validate(record);
        
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    });

    describe('missing required fields', () => {
      test('rejects null record', () => {
        const result = SyncRecordValidator.validate(null);
        
        expect(result.isValid).toBe(false);
        expect(result.errors[0].message).toContain('must be a valid object');
      });

      test('rejects undefined record', () => {
        const result = SyncRecordValidator.validate(undefined);
        
        expect(result.isValid).toBe(false);
        expect(result.errors[0].message).toContain('must be a valid object');
      });

      test('rejects record missing id', () => {
        const record = { ...validRecord, id: undefined };
        const result = SyncRecordValidator.validate(record);
        
        expect(result.isValid).toBe(false);
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            field: 'id',
            message: "Required field 'id' is missing"
          })
        );
      });

      test('rejects record missing multiple required fields', () => {
        const record = {
          modelName: 'Test',
          operation: 'create'
        };
        
        const result = SyncRecordValidator.validate(record);
        
        expect(result.isValid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(5);
      });
    });

    describe('field type validation', () => {
      test('rejects non-string id', () => {
        const record = { ...validRecord, id: 123 as any };
        const result = SyncRecordValidator.validate(record);
        
        expect(result.isValid).toBe(false);
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            field: 'id',
            message: "Field 'id' must be a string"
          })
        );
      });

      test('rejects negative version', () => {
        const record = { ...validRecord, version: -1 };
        const result = SyncRecordValidator.validate(record);
        
        expect(result.isValid).toBe(false);
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            field: 'version',
            message: 'Version must be a non-negative number'
          })
        );
      });

      test('rejects invalid operation', () => {
        const record = { ...validRecord, operation: 'invalid' as any };
        const result = SyncRecordValidator.validate(record);
        
        expect(result.isValid).toBe(false);
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            field: 'operation',
            message: expect.stringContaining('must be one of')
          })
        );
      });

      test('rejects unreasonable timestamp', () => {
        const record = { ...validRecord, timestamp: Date.now() + (400 * 24 * 60 * 60 * 1000) };
        const result = SyncRecordValidator.validate(record);
        
        expect(result.isValid).toBe(false);
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            field: 'timestamp',
            message: 'Timestamp is unreasonably far from current time'
          })
        );
      });

      test('rejects non-hexadecimal hash', () => {
        const record = { ...validRecord, hash: 'not-hex-@#$' };
        const result = SyncRecordValidator.validate(record);
        
        expect(result.isValid).toBe(false);
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            field: 'hash',
            message: 'Hash must be a valid hexadecimal string'
          })
        );
      });
    });

    describe('operation requirements', () => {
      test('rejects create without data', () => {
        const record = { ...validRecord, operation: 'create' as const, data: undefined };
        const result = SyncRecordValidator.validate(record);
        
        expect(result.isValid).toBe(false);
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            field: 'data',
            message: "Operation 'create' requires data payload"
          })
        );
      });

      test('rejects update without data', () => {
        const record = { ...validRecord, operation: 'update' as const, data: null };
        const result = SyncRecordValidator.validate(record);
        
        expect(result.isValid).toBe(false);
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            field: 'data',
            message: "Operation 'update' requires data payload"
          })
        );
      });

      test('rejects unknown model type', () => {
        (ModelRegistry.getModel as jest.Mock).mockReturnValue(undefined);
        
        const result = SyncRecordValidator.validate(validRecord);
        
        expect(result.isValid).toBe(false);
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            field: 'modelName',
            message: 'Unknown model type: TestModel'
          })
        );
      });
    });

    describe('security validation', () => {
      test('rejects script tags in data', () => {
        const record = {
          ...validRecord,
          data: {
            name: '<script>alert("XSS")</script>',
            value: 123
          }
        };
        
        const result = SyncRecordValidator.validate(record);
        
        expect(result.isValid).toBe(false);
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            field: 'data.name',
            message: 'String contains potentially malicious script tags'
          })
        );
      });

      test('rejects SQL injection patterns', () => {
        const record = {
          ...validRecord,
          modelId: "'; DROP TABLE users; --"
        };
        
        const result = SyncRecordValidator.validate(record);
        
        expect(result.isValid).toBe(false);
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            field: 'modelId',
            message: 'Field contains potentially malicious SQL patterns'
          })
        );
      });

      test('rejects prototype pollution attempts', () => {
        const record = {
          ...validRecord,
          data: {
            __proto__: { isAdmin: true },
            constructor: { dangerous: true },
            normal: 'value'
          }
        };
        
        const result = SyncRecordValidator.validate(record);
        
        expect(result.isValid).toBe(false);
        
        const protoErrors = result.errors.filter(e => 
          e.message.includes('Potentially malicious property name')
        );
        expect(protoErrors.length).toBeGreaterThan(0);
      });

      test('rejects deeply nested objects', () => {
        let deepData: any = { value: 'bottom' };
        for (let i = 0; i < 15; i++) {
          deepData = { nested: deepData };
        }
        
        const record = { ...validRecord, data: deepData };
        const result = SyncRecordValidator.validate(record);
        
        expect(result.isValid).toBe(false);
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            message: expect.stringContaining('exceeds maximum depth')
          })
        );
      });

      test('rejects overly large arrays', () => {
        const record = {
          ...validRecord,
          data: {
            bigArray: new Array(2000).fill('item')
          }
        };
        
        const result = SyncRecordValidator.validate(record);
        
        expect(result.isValid).toBe(false);
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            field: 'data.bigArray',
            message: expect.stringContaining('exceeds maximum length')
          })
        );
      });

      test('rejects overly long strings', () => {
        const record = {
          ...validRecord,
          data: {
            longString: 'x'.repeat(11000)
          }
        };
        
        const result = SyncRecordValidator.validate(record);
        
        expect(result.isValid).toBe(false);
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            field: 'data.longString',
            message: expect.stringContaining('exceeds maximum length')
          })
        );
      });

      test('rejects records exceeding size limit', () => {
        const record = {
          ...validRecord,
          data: {
            huge: 'x'.repeat(1024 * 1024) // 1MB of 'x'
          }
        };
        
        const result = SyncRecordValidator.validate(record);
        
        expect(result.isValid).toBe(false);
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            field: 'record',
            message: 'Record size exceeds 1MB limit'
          })
        );
      });

      test('rejects non-finite numbers', () => {
        const record = {
          ...validRecord,
          data: {
            infinite: Infinity,
            notANumber: NaN
          }
        };
        
        const result = SyncRecordValidator.validate(record);
        
        expect(result.isValid).toBe(false);
        
        const numberErrors = result.errors.filter(e => 
          e.message.includes('Number must be finite')
        );
        expect(numberErrors).toHaveLength(2);
      });
    });
  });

  describe('sanitize', () => {
    test('sanitizes script tags', () => {
      const record: SyncRecord = {
        id: 'test',
        modelName: 'Test',
        modelId: 'test_123',
        operation: 'create',
        data: {
          name: '<script>alert("XSS")</script>Normal text',
          safe: 'No issues here'
        },
        version: 1,
        timestamp: Date.now(),
        clientId: 'client',
        hash: 'abc123'
      };
      
      const sanitized = SyncRecordValidator.sanitize(record);
      
      expect(sanitized.data.name).not.toContain('<script>');
      expect(sanitized.data.name).toContain('Normal text');
      expect(sanitized.data.safe).toBe('No issues here');
    });

    test('sanitizes SQL injection attempts', () => {
      const record: SyncRecord = {
        id: "test'; DROP TABLE users; --",
        modelName: 'Test',
        modelId: 'test_123',
        operation: 'create',
        data: { value: 123 },
        version: 1,
        timestamp: Date.now(),
        clientId: 'client',
        hash: 'abc123'
      };
      
      const sanitized = SyncRecordValidator.sanitize(record);
      
      expect(sanitized.id).not.toContain('DROP TABLE');
      expect(sanitized.id).toContain('test');
    });

    test('removes prototype pollution attempts', () => {
      const record: SyncRecord = {
        id: 'test',
        modelName: 'Test',
        modelId: 'test_123',
        operation: 'create',
        data: {
          __proto__: { isAdmin: true },
          constructor: { dangerous: true },
          prototype: { evil: true },
          normal: 'value'
        },
        version: 1,
        timestamp: Date.now(),
        clientId: 'client',
        hash: 'abc123'
      };
      
      const sanitized = SyncRecordValidator.sanitize(record);
      
      // Dangerous properties should be removed (not present in sanitized object)
      expect(sanitized.data.hasOwnProperty('__proto__')).toBe(false);
      expect(sanitized.data.hasOwnProperty('constructor')).toBe(false);
      expect(sanitized.data.hasOwnProperty('prototype')).toBe(false);
      expect(sanitized.data.normal).toBe('value');
    });

    test('truncates deeply nested objects', () => {
      let deepData: any = { value: 'bottom' };
      for (let i = 0; i < 15; i++) {
        deepData = { nested: deepData };
      }
      
      const record: SyncRecord = {
        id: 'test',
        modelName: 'Test',
        modelId: 'test_123',
        operation: 'create',
        data: deepData,
        version: 1,
        timestamp: Date.now(),
        clientId: 'client',
        hash: 'abc123'
      };
      
      const sanitized = SyncRecordValidator.sanitize(record);
      
      // Check that deep nesting is truncated
      let depth = 0;
      let current = sanitized.data;
      while (current && current.nested) {
        depth++;
        current = current.nested;
      }
      
      expect(depth).toBeLessThanOrEqual(10);
    });

    test('truncates large arrays', () => {
      const record: SyncRecord = {
        id: 'test',
        modelName: 'Test',
        modelId: 'test_123',
        operation: 'create',
        data: {
          bigArray: new Array(2000).fill('item')
        },
        version: 1,
        timestamp: Date.now(),
        clientId: 'client',
        hash: 'abc123'
      };
      
      const sanitized = SyncRecordValidator.sanitize(record);
      
      expect(sanitized.data.bigArray.length).toBeLessThanOrEqual(1000);
    });

    test('replaces non-finite numbers', () => {
      const record: SyncRecord = {
        id: 'test',
        modelName: 'Test',
        modelId: 'test_123',
        operation: 'create',
        data: {
          infinite: Infinity,
          negInfinite: -Infinity,
          notANumber: NaN,
          normal: 42
        },
        version: 1,
        timestamp: Date.now(),
        clientId: 'client',
        hash: 'abc123'
      };
      
      const sanitized = SyncRecordValidator.sanitize(record);
      
      // Non-finite numbers should be replaced with 0
      expect(sanitized.data.infinite).toBe(0);
      expect(sanitized.data.negInfinite).toBe(0);
      expect(sanitized.data.notANumber).toBe(0);
      expect(sanitized.data.normal).toBe(42);
    });

    test('escapes HTML characters', () => {
      const record: SyncRecord = {
        id: 'test<>&"\'/test',
        modelName: 'Test',
        modelId: 'test_123',
        operation: 'create',
        data: {
          html: '<div onclick="alert()">Click me</div>'
        },
        version: 1,
        timestamp: Date.now(),
        clientId: 'client',
        hash: 'abc123'
      };
      
      const sanitized = SyncRecordValidator.sanitize(record);
      
      expect(sanitized.id).not.toContain('<');
      expect(sanitized.id).not.toContain('>');
      expect(sanitized.data.html).not.toContain('<div');
      expect(sanitized.data.html).not.toContain('onclick');
    });

    test('preserves valid data while sanitizing dangerous content', () => {
      const record: SyncRecord = {
        id: 'valid_id_123',
        modelName: 'TestModel',
        modelId: 'model_123',
        operation: 'update',
        data: {
          name: 'John Doe',
          email: 'john@example.com',
          age: 30,
          active: true,
          metadata: {
            created: '2024-01-01',
            tags: ['user', 'active', 'premium']
          }
        },
        version: 2,
        timestamp: Date.now(),
        clientId: 'client_abc',
        hash: 'def456abc123'
      };
      
      const sanitized = SyncRecordValidator.sanitize(record);
      
      // Valid data should be preserved
      expect(sanitized.id).toBe('valid_id_123');
      expect(sanitized.modelName).toBe('TestModel');
      expect(sanitized.data.name).toBe('John Doe');
      expect(sanitized.data.email).toBe('john@example.com');
      expect(sanitized.data.age).toBe(30);
      expect(sanitized.data.active).toBe(true);
      expect(sanitized.data.metadata.tags).toEqual(['user', 'active', 'premium']);
    });
  });
});