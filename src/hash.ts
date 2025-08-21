import { ModelMetadata } from "./model-registry";

export class SchemaHasher {
    static async generateDatabaseHash(models: ModelMetadata[]): Promise<string> {
      // 1. Sort models alphabetically
      const sortedModels = models.sort((a, b) => 
        a.name.localeCompare(b.name)
      );
  
      // 2. Serialize each model consistently
      const serializedModels = sortedModels.map(model => 
        this.serializeModelMetadata(model)
      );
  
      // 3. Create single hashable string
      const hashContent = serializedModels.join('|');
  
      // 4. Generate SHA-256 hash
      const hashBuffer = await crypto.subtle.digest('SHA-1',
        new TextEncoder().encode(hashContent)
      );
  
      // 5. Convert to hex and truncate
      return this.bufferToHex(hashBuffer).substring(0, 16);
    }

    static async generateStoreHash(model: ModelMetadata): Promise<string> {
        const serializedModel = this.serializeModelMetadata(model);
        const hashBuffer = await crypto.subtle.digest('SHA-1',
            new TextEncoder().encode(serializedModel)
        );
        return this.bufferToHex(hashBuffer).substring(0, 16);
    }
  
    private static serializeModelMetadata(model: ModelMetadata): string {
      // Sort properties alphabetically
      const sortedProps = Object.entries(model.properties)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, meta]) => `${name}:${meta.type}:${meta.indexed}`);
  
      return JSON.stringify({
        name: model.name,
        version: model.schemaVersion,
        loadStrategy: model.loadStrategy,
        properties: sortedProps
      }, null, 0);
    }
  
    private static bufferToHex(buffer: ArrayBuffer): string {
      return Array.from(new Uint8Array(buffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    }
  }