import { 
  DeltaPacket, 
  DeltaAction, 
  DeltaPacketBuilder, 
  DeltaValidator 
} from '../../src/sync/delta-packet';

describe('DeltaPacket', () => {
  describe('DeltaPacketBuilder', () => {
    it('should build a complete delta packet', () => {
      const packet = DeltaPacketBuilder.create()
        .withId(123)
        .withModelName('User')
        .withModelId('user-1')
        .withAction(DeltaAction.UPDATE)
        .withData({ name: 'John', email: 'john@example.com' })
        .withPreviousData({ name: 'Jane', email: 'jane@example.com' })
        .withTimestamp(1000000)
        .withUserId('admin-1')
        .build();

      expect(packet).toEqual({
        id: 123,
        modelName: 'User',
        modelId: 'user-1',
        action: DeltaAction.UPDATE,
        data: { name: 'John', email: 'john@example.com' },
        previousData: { name: 'Jane', email: 'jane@example.com' },
        timestamp: 1000000,
        userId: 'admin-1',
      });
    });

    it('should build a minimal delta packet', () => {
      const packet = DeltaPacketBuilder.create()
        .withId(1)
        .withModelName('Task')
        .withModelId('task-1')
        .withAction(DeltaAction.DELETE)
        .build();

      expect(packet).toEqual({
        id: 1,
        modelName: 'Task',
        modelId: 'task-1',
        action: DeltaAction.DELETE,
      });
    });

    it('should use current timestamp if not provided', () => {
      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);

      const packet = DeltaPacketBuilder.create()
        .withId(1)
        .withModelName('Task')
        .withModelId('task-1')
        .withAction(DeltaAction.CREATE)
        .withTimestamp()
        .build();

      expect(packet.timestamp).toBe(now);
    });

    it('should throw error when required fields are missing', () => {
      expect(() => {
        DeltaPacketBuilder.create()
          .withModelName('User')
          .withModelId('user-1')
          .withAction(DeltaAction.UPDATE)
          .build();
      }).toThrow('Delta packet missing required fields');

      expect(() => {
        DeltaPacketBuilder.create()
          .withId(1)
          .withModelId('user-1')
          .withAction(DeltaAction.UPDATE)
          .build();
      }).toThrow('Delta packet missing required fields');

      expect(() => {
        DeltaPacketBuilder.create()
          .withId(1)
          .withModelName('User')
          .withAction(DeltaAction.UPDATE)
          .build();
      }).toThrow('Delta packet missing required fields');

      expect(() => {
        DeltaPacketBuilder.create()
          .withId(1)
          .withModelName('User')
          .withModelId('user-1')
          .build();
      }).toThrow('Delta packet missing required fields');
    });
  });

  describe('DeltaValidator', () => {
    describe('isValid', () => {
      it('should return true for valid packet', () => {
        const packet: DeltaPacket = {
          id: 1,
          modelName: 'User',
          modelId: 'user-1',
          action: DeltaAction.UPDATE,
          data: { name: 'John' },
        };

        expect(DeltaValidator.isValid(packet)).toBe(true);
      });

      it('should return false for invalid packets', () => {
        expect(DeltaValidator.isValid({} as DeltaPacket)).toBe(false);
        
        expect(DeltaValidator.isValid({
          modelName: 'User',
          modelId: 'user-1',
          action: DeltaAction.UPDATE,
        } as DeltaPacket)).toBe(false);

        expect(DeltaValidator.isValid({
          id: 1,
          modelId: 'user-1',
          action: DeltaAction.UPDATE,
        } as DeltaPacket)).toBe(false);

        expect(DeltaValidator.isValid({
          id: 1,
          modelName: 'User',
          action: DeltaAction.UPDATE,
        } as DeltaPacket)).toBe(false);

        expect(DeltaValidator.isValid({
          id: 1,
          modelName: 'User',
          modelId: 'user-1',
        } as DeltaPacket)).toBe(false);

        expect(DeltaValidator.isValid({
          id: 1,
          modelName: 'User',
          modelId: 'user-1',
          action: 'INVALID' as DeltaAction,
        } as DeltaPacket)).toBe(false);
      });
    });

    describe('validate', () => {
      it('should not throw for valid packet', () => {
        const packet: DeltaPacket = {
          id: 1,
          modelName: 'User',
          modelId: 'user-1',
          action: DeltaAction.UPDATE,
          data: { name: 'John' },
        };

        expect(() => DeltaValidator.validate(packet)).not.toThrow();
      });

      it('should throw for invalid ID', () => {
        const packet: DeltaPacket = {
          id: 0,
          modelName: 'User',
          modelId: 'user-1',
          action: DeltaAction.UPDATE,
        };

        expect(() => DeltaValidator.validate(packet)).toThrow('Invalid delta packet ID');
      });

      it('should throw for missing model name', () => {
        const packet = {
          id: 1,
          modelId: 'user-1',
          action: DeltaAction.UPDATE,
        } as DeltaPacket;

        expect(() => DeltaValidator.validate(packet)).toThrow('Delta packet missing model name');
      });

      it('should throw for missing model ID', () => {
        const packet = {
          id: 1,
          modelName: 'User',
          action: DeltaAction.UPDATE,
        } as DeltaPacket;

        expect(() => DeltaValidator.validate(packet)).toThrow('Delta packet missing model ID');
      });

      it('should throw for invalid action', () => {
        const packet = {
          id: 1,
          modelName: 'User',
          modelId: 'user-1',
          action: 'INVALID',
        } as any;

        expect(() => DeltaValidator.validate(packet)).toThrow('Invalid delta action: INVALID');
      });

      it('should throw when data is required but missing', () => {
        const packet: DeltaPacket = {
          id: 1,
          modelName: 'User',
          modelId: 'user-1',
          action: DeltaAction.INSERT,
        };

        expect(() => DeltaValidator.validate(packet)).toThrow('Delta action I requires data');

        packet.action = DeltaAction.UPDATE;
        expect(() => DeltaValidator.validate(packet)).toThrow('Delta action U requires data');

        packet.action = DeltaAction.CREATE;
        expect(() => DeltaValidator.validate(packet)).toThrow('Delta action C requires data');
      });

      it('should not throw for DELETE without data', () => {
        const packet: DeltaPacket = {
          id: 1,
          modelName: 'User',
          modelId: 'user-1',
          action: DeltaAction.DELETE,
        };

        expect(() => DeltaValidator.validate(packet)).not.toThrow();
      });
    });
  });

  describe('DeltaAction enum', () => {
    it('should have all expected actions', () => {
      expect(DeltaAction.INSERT).toBe('I');
      expect(DeltaAction.UPDATE).toBe('U');
      expect(DeltaAction.ARCHIVE).toBe('A');
      expect(DeltaAction.DELETE).toBe('D');
      expect(DeltaAction.CREATE).toBe('C');
      expect(DeltaAction.GAP).toBe('G');
      expect(DeltaAction.SYNC).toBe('S');
      expect(DeltaAction.VALIDATION).toBe('V');
    });
  });
});