import { XvifcFormActorsService } from './xvifc-form-actors.service';
import type { XvifcActorSourceDocument } from '../types/xvifc-form-actors.type';

describe('XvifcFormActorsService', () => {
  let service: XvifcFormActorsService;

  beforeEach(() => {
    service = new XvifcFormActorsService();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('buildActorsAndStateName', () => {
    it('returns empty stateName and null actor fields for a null document', () => {
      const result = service.buildActorsAndStateName(null);

      expect(result.stateName).toBe('');
      expect(result.actors).toHaveLength(3);
      result.actors.forEach((actor) => {
        expect(actor.by).toBeNull();
        expect(actor.date).toBeNull();
      });
    });

    it('resolves stateName from a populated state.name field', () => {
      const doc: XvifcActorSourceDocument = { state: { name: 'Karnataka' } };
      const result = service.buildActorsAndStateName(doc);
      expect(result.stateName).toBe('Karnataka');
    });

    it('defaults stateName to empty string when state is not populated', () => {
      const doc: XvifcActorSourceDocument = { state: '64f0000000000000000000aa' as unknown };
      const result = service.buildActorsAndStateName(doc);
      expect(result.stateName).toBe('');
    });

    it('builds Created by / Updated by / Submitted by actors in that order with fixed designations', () => {
      const doc: XvifcActorSourceDocument = {
        createdBy: { name: 'Alice' },
        updatedBy: { name: 'Bob' },
        submittedBy: { name: 'Carol' },
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
        submittedAt: new Date('2026-01-03T00:00:00.000Z'),
      };

      const { actors } = service.buildActorsAndStateName(doc);

      expect(actors).toEqual([
        {
          action: 'Created by',
          designation: 'State DMA Officer',
          by: 'Alice',
          date: '2026-01-01T00:00:00.000Z',
        },
        {
          action: 'Updated by',
          designation: 'State DMA Officer',
          by: 'Bob',
          date: '2026-01-02T00:00:00.000Z',
        },
        {
          action: 'Submitted by',
          designation: 'State DMA Officer',
          by: 'Carol',
          date: '2026-01-03T00:00:00.000Z',
        },
      ]);
    });

    it('returns null "by" when the populated ref has no name field', () => {
      const doc: XvifcActorSourceDocument = { createdBy: { _id: 'abc' } };
      const { actors } = service.buildActorsAndStateName(doc);
      expect(actors[0].by).toBeNull();
    });

    it('returns null "by" when the populated ref is a non-object (unpopulated ObjectId string)', () => {
      const doc: XvifcActorSourceDocument = { createdBy: '64f0000000000000000000aa' as unknown };
      const { actors } = service.buildActorsAndStateName(doc);
      expect(actors[0].by).toBeNull();
    });

    it('returns null "by" when the populated ref is null', () => {
      const doc: XvifcActorSourceDocument = { createdBy: null };
      const { actors } = service.buildActorsAndStateName(doc);
      expect(actors[0].by).toBeNull();
    });

    it('returns null date when the timestamp is not a Date instance (e.g. a raw string)', () => {
      const doc: XvifcActorSourceDocument = { createdAt: '2026-01-01T00:00:00.000Z' as unknown as Date };
      const { actors } = service.buildActorsAndStateName(doc);
      expect(actors[0].date).toBeNull();
    });

    it('returns null date for an invalid Date instance', () => {
      const doc: XvifcActorSourceDocument = { createdAt: new Date('not-a-date') };
      const { actors } = service.buildActorsAndStateName(doc);
      expect(actors[0].date).toBeNull();
    });

    it('returns null date when the timestamp is undefined', () => {
      const doc: XvifcActorSourceDocument = {};
      const { actors } = service.buildActorsAndStateName(doc);
      expect(actors.map((a) => a.date)).toEqual([null, null, null]);
    });

    it('"Updated by" prefers stateUpdatedBy/stateUpdatedAt over the generic updatedBy/updatedAt — a PMU/MoHUA review action must never surface as the State\'s own last update', () => {
      const doc: XvifcActorSourceDocument = {
        updatedBy: { name: 'PMU Reviewer' },
        updatedAt: new Date('2026-02-01T00:00:00.000Z'),
        stateUpdatedBy: { name: 'State Officer' },
        stateUpdatedAt: new Date('2026-01-15T00:00:00.000Z'),
      };

      const { actors } = service.buildActorsAndStateName(doc);
      const updatedByActor = actors.find((a) => a.action === 'Updated by');

      expect(updatedByActor?.by).toBe('State Officer');
      expect(updatedByActor?.date).toBe('2026-01-15T00:00:00.000Z');
    });

    it('"Updated by" falls back to the generic updatedBy/updatedAt when stateUpdatedBy/stateUpdatedAt is absent (documents saved before this field existed)', () => {
      const doc: XvifcActorSourceDocument = {
        updatedBy: { name: 'Legacy Updater' },
        updatedAt: new Date('2026-02-01T00:00:00.000Z'),
      };

      const { actors } = service.buildActorsAndStateName(doc);
      const updatedByActor = actors.find((a) => a.action === 'Updated by');

      expect(updatedByActor?.by).toBe('Legacy Updater');
      expect(updatedByActor?.date).toBe('2026-02-01T00:00:00.000Z');
    });
  });
});
