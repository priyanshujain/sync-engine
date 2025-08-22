export enum DeltaAction {
  INSERT = 'I',
  UPDATE = 'U',
  ARCHIVE = 'A',
  DELETE = 'D',
  CREATE = 'C',
  GAP = 'G',
  SYNC = 'S',
  VALIDATION = 'V',
}

export interface DeltaPacket {
  id: number;
  modelName: string;
  modelId: string;
  action: DeltaAction;
  data?: any;
  previousData?: any;
  timestamp?: number;
  userId?: string;
}

export interface DeltaBatch {
  packets: DeltaPacket[];
  startSyncId: number;
  endSyncId: number;
  timestamp: number;
}

export class DeltaPacketBuilder {
  private packet: Partial<DeltaPacket> = {};

  withId(id: number): this {
    this.packet.id = id;
    return this;
  }

  withModelName(modelName: string): this {
    this.packet.modelName = modelName;
    return this;
  }

  withModelId(modelId: string): this {
    this.packet.modelId = modelId;
    return this;
  }

  withAction(action: DeltaAction): this {
    this.packet.action = action;
    return this;
  }

  withData(data: any): this {
    this.packet.data = data;
    return this;
  }

  withPreviousData(previousData: any): this {
    this.packet.previousData = previousData;
    return this;
  }

  withTimestamp(timestamp?: number): this {
    this.packet.timestamp = timestamp || Date.now();
    return this;
  }

  withUserId(userId: string): this {
    this.packet.userId = userId;
    return this;
  }

  build(): DeltaPacket {
    if (!this.packet.id || !this.packet.modelName || !this.packet.modelId || !this.packet.action) {
      throw new Error('Delta packet missing required fields');
    }

    return this.packet as DeltaPacket;
  }

  static create(): DeltaPacketBuilder {
    return new DeltaPacketBuilder();
  }
}

export class DeltaValidator {
  static isValid(packet: DeltaPacket): boolean {
    return !!(
      packet.id &&
      packet.modelName &&
      packet.modelId &&
      packet.action &&
      Object.values(DeltaAction).includes(packet.action)
    );
  }

  static validate(packet: DeltaPacket): void {
    if (!packet.id || packet.id <= 0) {
      throw new Error('Invalid delta packet ID');
    }

    if (!packet.modelName) {
      throw new Error('Delta packet missing model name');
    }

    if (!packet.modelId) {
      throw new Error('Delta packet missing model ID');
    }

    if (!packet.action || !Object.values(DeltaAction).includes(packet.action)) {
      throw new Error(`Invalid delta action: ${packet.action}`);
    }

    if ([DeltaAction.INSERT, DeltaAction.UPDATE, DeltaAction.CREATE].includes(packet.action) && !packet.data) {
      throw new Error(`Delta action ${packet.action} requires data`);
    }
  }
}