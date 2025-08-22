import { SyncRecord, SyncOperation } from './hash-sync-engine';
import { ModelRegistry } from '../model-registry';

export interface ValidationError {
  field: string;
  message: string;
  value?: any;
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
}

/**
 * Validates sync records to prevent security vulnerabilities and data corruption
 */
export class SyncRecordValidator {
  private static readonly MAX_STRING_LENGTH = 10000;
  private static readonly MAX_OBJECT_DEPTH = 10;
  private static readonly MAX_ARRAY_LENGTH = 1000;
  private static readonly VALID_OPERATIONS: SyncOperation[] = ['create', 'update', 'delete'];
  
  /**
   * Validates a sync record completely
   */
  static validate(record: any): ValidationResult {
    const errors: ValidationError[] = [];
    
    // Check if record exists
    if (!record || typeof record !== 'object') {
      return {
        isValid: false,
        errors: [{ field: 'record', message: 'Record must be a valid object' }]
      };
    }
    
    // Validate required fields
    this.validateRequiredFields(record, errors);
    
    // Validate field types and values
    this.validateFieldTypes(record, errors);
    
    // Validate operation-specific requirements
    this.validateOperationRequirements(record, errors);
    
    // Validate data payload
    if (record.data) {
      this.validateDataPayload(record.data, errors, 'data');
    }
    
    // Check for potentially malicious content
    this.validateSecurityConstraints(record, errors);
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }
  
  /**
   * Validates required fields are present
   */
  private static validateRequiredFields(record: any, errors: ValidationError[]): void {
    const requiredFields = ['id', 'modelName', 'modelId', 'operation', 'version', 'timestamp', 'clientId', 'hash'];
    
    for (const field of requiredFields) {
      if (record[field] === undefined || record[field] === null) {
        errors.push({
          field,
          message: `Required field '${field}' is missing`,
          value: record[field]
        });
      }
    }
  }
  
  /**
   * Validates field types and basic constraints
   */
  private static validateFieldTypes(record: any, errors: ValidationError[]): void {
    // Validate ID fields are strings
    const stringFields = ['id', 'modelName', 'modelId', 'clientId', 'hash'];
    for (const field of stringFields) {
      if (record[field] !== undefined && typeof record[field] !== 'string') {
        errors.push({
          field,
          message: `Field '${field}' must be a string`,
          value: record[field]
        });
      } else if (record[field] && record[field].length > this.MAX_STRING_LENGTH) {
        errors.push({
          field,
          message: `Field '${field}' exceeds maximum length of ${this.MAX_STRING_LENGTH}`,
          value: record[field]?.substring(0, 100) + '...'
        });
      }
    }
    
    // Validate version is a positive number
    if (record.version !== undefined) {
      if (typeof record.version !== 'number' || record.version < 0) {
        errors.push({
          field: 'version',
          message: 'Version must be a non-negative number',
          value: record.version
        });
      }
    }
    
    // Validate timestamp
    if (record.timestamp !== undefined) {
      if (typeof record.timestamp !== 'number' || record.timestamp < 0) {
        errors.push({
          field: 'timestamp',
          message: 'Timestamp must be a valid positive number',
          value: record.timestamp
        });
      }
      
      // Check if timestamp is reasonable (not too far in past or future)
      const now = Date.now();
      const oneYearMs = 365 * 24 * 60 * 60 * 1000;
      if (Math.abs(record.timestamp - now) > oneYearMs) {
        errors.push({
          field: 'timestamp',
          message: 'Timestamp is unreasonably far from current time',
          value: new Date(record.timestamp).toISOString()
        });
      }
    }
    
    // Validate operation
    if (record.operation && !this.VALID_OPERATIONS.includes(record.operation)) {
      errors.push({
        field: 'operation',
        message: `Operation must be one of: ${this.VALID_OPERATIONS.join(', ')}`,
        value: record.operation
      });
    }
  }
  
  /**
   * Validates operation-specific requirements
   */
  private static validateOperationRequirements(record: any, errors: ValidationError[]): void {
    if (!record.operation) return;
    
    switch (record.operation) {
      case 'create':
      case 'update':
        if (!record.data || typeof record.data !== 'object') {
          errors.push({
            field: 'data',
            message: `Operation '${record.operation}' requires data payload`,
            value: record.data
          });
        }
        break;
        
      case 'delete':
        // Delete operations may or may not have data
        break;
        
      default:
        // Already validated in validateFieldTypes
        break;
    }
    
    // Validate model exists in registry
    if (record.modelName) {
      const model = ModelRegistry.getModel(record.modelName);
      if (!model) {
        errors.push({
          field: 'modelName',
          message: `Unknown model type: ${record.modelName}`,
          value: record.modelName
        });
      }
    }
  }
  
  /**
   * Recursively validates data payload for security issues
   */
  private static validateDataPayload(
    data: any,
    errors: ValidationError[],
    path: string,
    depth: number = 0
  ): void {
    // Check depth to prevent deeply nested objects
    if (depth > this.MAX_OBJECT_DEPTH) {
      errors.push({
        field: path,
        message: `Object nesting exceeds maximum depth of ${this.MAX_OBJECT_DEPTH}`,
        value: 'Object too deep'
      });
      return;
    }
    
    // Handle null/undefined
    if (data === null || data === undefined) {
      return;
    }
    
    // Handle arrays
    if (Array.isArray(data)) {
      if (data.length > this.MAX_ARRAY_LENGTH) {
        errors.push({
          field: path,
          message: `Array exceeds maximum length of ${this.MAX_ARRAY_LENGTH}`,
          value: `Array length: ${data.length}`
        });
        return;
      }
      
      data.forEach((item, index) => {
        this.validateDataPayload(item, errors, `${path}[${index}]`, depth + 1);
      });
      return;
    }
    
    // Handle objects
    if (typeof data === 'object') {
      const keys = Object.keys(data);
      
      // Check for too many keys
      if (keys.length > 1000) {
        errors.push({
          field: path,
          message: 'Object has too many properties (max 1000)',
          value: `Property count: ${keys.length}`
        });
        return;
      }
      
      // Recursively validate each property
      for (const key of keys) {
        // Check for prototype pollution attempts
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
          errors.push({
            field: `${path}.${key}`,
            message: 'Potentially malicious property name detected',
            value: key
          });
          continue;
        }
        
        // Validate key length
        if (key.length > 255) {
          errors.push({
            field: `${path}.${key}`,
            message: 'Property name exceeds maximum length of 255',
            value: key.substring(0, 50) + '...'
          });
          continue;
        }
        
        this.validateDataPayload(data[key], errors, `${path}.${key}`, depth + 1);
      }
      return;
    }
    
    // Handle primitives
    if (typeof data === 'string') {
      if (data.length > this.MAX_STRING_LENGTH) {
        errors.push({
          field: path,
          message: `String exceeds maximum length of ${this.MAX_STRING_LENGTH}`,
          value: data.substring(0, 100) + '...'
        });
      }
      
      // Check for potential script injection
      if (this.containsScriptTags(data)) {
        errors.push({
          field: path,
          message: 'String contains potentially malicious script tags',
          value: data.substring(0, 100)
        });
      }
    }
    
    // Numbers should be finite
    if (typeof data === 'number' && !isFinite(data)) {
      errors.push({
        field: path,
        message: 'Number must be finite',
        value: data
      });
    }
  }
  
  /**
   * Validates security constraints
   */
  private static validateSecurityConstraints(record: any, errors: ValidationError[]): void {
    // Check for SQL injection patterns in string fields
    const stringFields = ['id', 'modelName', 'modelId', 'clientId'];
    for (const field of stringFields) {
      if (record[field] && this.containsSqlInjectionPattern(record[field])) {
        errors.push({
          field,
          message: 'Field contains potentially malicious SQL patterns',
          value: record[field]
        });
      }
    }
    
    // Validate hash format (should be hexadecimal)
    if (record.hash && !/^[a-f0-9]+$/i.test(record.hash)) {
      errors.push({
        field: 'hash',
        message: 'Hash must be a valid hexadecimal string',
        value: record.hash
      });
    }
    
    // Check total size of record
    const recordSize = JSON.stringify(record).length;
    if (recordSize > 1024 * 1024) { // 1MB limit
      errors.push({
        field: 'record',
        message: 'Record size exceeds 1MB limit',
        value: `Size: ${recordSize} bytes`
      });
    }
  }
  
  /**
   * Checks for script tags in strings
   */
  private static containsScriptTags(value: string): boolean {
    const scriptPatterns = [
      /<script[\s>]/i,
      /<\/script>/i,
      /javascript:/i,
      /on\w+\s*=/i, // Event handlers like onclick=
      /<iframe[\s>]/i,
      /<embed[\s>]/i,
      /<object[\s>]/i
    ];
    
    return scriptPatterns.some(pattern => pattern.test(value));
  }
  
  /**
   * Checks for SQL injection patterns
   */
  private static containsSqlInjectionPattern(value: string): boolean {
    const sqlPatterns = [
      /(\b(DELETE|DROP|EXEC(UTE)?|INSERT|SELECT|UNION|UPDATE)\b)/i,
      /(--|\||;|\/\*|\*\/)/,
      /(\bOR\b\s*\d+\s*=\s*\d+)/i,
      /(\bAND\b\s*\d+\s*=\s*\d+)/i,
      /(\'|\")(\s*)(OR|AND)(\s*)(\d+|\'|\")(\s*)=/i
    ];
    
    return sqlPatterns.some(pattern => pattern.test(value));
  }
  
  /**
   * Sanitizes a record by removing or escaping potentially dangerous content
   * Returns a new sanitized copy, doesn't modify the original
   */
  static sanitize(record: SyncRecord): SyncRecord {
    // Use a custom deep clone that properly handles special values
    const sanitized = this.deepClone(record);
    
    // Sanitize string fields
    const stringFields = ['id', 'modelName', 'modelId', 'clientId', 'hash'];
    for (const field of stringFields) {
      if (sanitized[field] && typeof sanitized[field] === 'string') {
        sanitized[field] = this.sanitizeString(sanitized[field]);
      }
    }
    
    // Recursively sanitize data payload
    if (sanitized.data) {
      sanitized.data = this.sanitizeData(sanitized.data);
    }
    
    return sanitized;
  }
  
  /**
   * Deep clones an object while handling special values
   */
  private static deepClone(obj: any): any {
    if (obj === null || obj === undefined) {
      return obj;
    }
    
    if (obj instanceof Date) {
      return new Date(obj.getTime());
    }
    
    if (Array.isArray(obj)) {
      return obj.map(item => this.deepClone(item));
    }
    
    if (typeof obj === 'object') {
      const cloned: any = {};
      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          // Skip dangerous property names during cloning
          if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
            continue;
          }
          cloned[key] = this.deepClone(obj[key]);
        }
      }
      return cloned;
    }
    
    // Handle special number values
    if (typeof obj === 'number') {
      if (!isFinite(obj)) {
        return 0; // Replace Infinity/NaN with 0
      }
    }
    
    return obj;
  }
  
  /**
   * Sanitizes a string value
   */
  private static sanitizeString(value: string): string {
    // Remove any HTML/script tags
    let sanitized = value.replace(/<[^>]*>/g, '');
    
    // For SQL keywords, only remove them if they appear as standalone commands
    // Don't remove them from normal text like "Update" in "Remote Update"
    sanitized = sanitized.replace(/;\s*(DELETE|DROP|EXEC(UTE)?|INSERT|SELECT|UNION|UPDATE)\s+/gi, '; ');
    
    // Remove script-related patterns
    sanitized = sanitized.replace(/javascript:/gi, '');
    sanitized = sanitized.replace(/on\w+\s*=/gi, '');
    
    // Escape HTML special characters
    sanitized = sanitized
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
    
    // Truncate if too long
    if (sanitized.length > this.MAX_STRING_LENGTH) {
      sanitized = sanitized.substring(0, this.MAX_STRING_LENGTH);
    }
    
    return sanitized;
  }
  
  /**
   * Recursively sanitizes data objects
   */
  private static sanitizeData(data: any, depth: number = 0): any {
    if (depth > this.MAX_OBJECT_DEPTH) {
      return null; // Truncate deeply nested objects
    }
    
    if (data === null || data === undefined) {
      return data;
    }
    
    if (Array.isArray(data)) {
      return data
        .slice(0, this.MAX_ARRAY_LENGTH)
        .map(item => this.sanitizeData(item, depth + 1));
    }
    
    if (typeof data === 'object') {
      const sanitized: any = {};
      const keys = Object.keys(data).slice(0, 1000);
      
      for (const key of keys) {
        // Skip dangerous property names entirely, don't add them to sanitized
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
          continue;
        }
        
        const sanitizedKey = key.length > 255 ? key.substring(0, 255) : key;
        sanitized[sanitizedKey] = this.sanitizeData(data[key], depth + 1);
      }
      
      return sanitized;
    }
    
    if (typeof data === 'string') {
      return this.sanitizeString(data);
    }
    
    if (typeof data === 'number') {
      // Replace Infinity/NaN with 0
      if (!isFinite(data)) {
        return 0;
      }
      return data;
    }
    
    return data;
  }
}