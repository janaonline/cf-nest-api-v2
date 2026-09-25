import { DataCollectionSchema } from './data-collection.schema';

describe('DataCollectionSchema', () => {
  describe('reversal fields', () => {
    it('isActive defaults to true', () => {
      const path = DataCollectionSchema.path('isActive');
      expect(path).toBeDefined();
      expect((path as { defaultValue?: unknown }).defaultValue).toBe(true);
    });

    it('status defaults to ACTIVE', () => {
      const path = DataCollectionSchema.path('status');
      expect(path).toBeDefined();
      expect((path as { defaultValue?: unknown }).defaultValue).toBe('ACTIVE');
    });

    it('status is restricted to ACTIVE and REVERSED', () => {
      const path = DataCollectionSchema.path('status') as { enumValues?: string[] };
      expect(path.enumValues).toEqual(['ACTIVE', 'REVERSED']);
    });

    it('reversedAt path exists and is optional', () => {
      const path = DataCollectionSchema.path('reversedAt');
      expect(path).toBeDefined();
      expect(path.isRequired).toBeFalsy();
    });

    it('reversedBy path exists and is optional', () => {
      const path = DataCollectionSchema.path('reversedBy');
      expect(path).toBeDefined();
      expect(path.isRequired).toBeFalsy();
    });

    it('reversalReason path exists and is optional', () => {
      const path = DataCollectionSchema.path('reversalReason');
      expect(path).toBeDefined();
      expect(path.isRequired).toBeFalsy();
    });
  });

  describe('unique index is partial on isActive', () => {
    it('has a partial unique index for ulbId + yearId scoped to isActive: true', () => {
      const indexes = DataCollectionSchema.indexes();
      const uniqueUlbYear = indexes.find(([keys, opts]) => {
        const k = keys as Record<string, number>;
        return k['ulbId'] === 1 && k['yearId'] === 1 && (opts as Record<string, unknown>)['unique'] === true;
      });
      expect(uniqueUlbYear).toBeDefined();
      const opts = uniqueUlbYear![1] as Record<string, unknown>;
      const filter = opts['partialFilterExpression'] as Record<string, unknown>;
      expect(filter).toEqual({ isActive: true });
    });
  });
});
