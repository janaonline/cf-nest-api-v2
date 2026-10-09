import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { StateFormPmuReviewHelper } from './state-form-pmu-review.helper';

/** Creates a chainable Mongoose Query-like mock that resolves to `value`. */
function q<T>(value: T) {
  const chain: Record<string, unknown> = { session: jest.fn().mockReturnThis() };
  chain['exec'] = jest.fn().mockResolvedValue(value);
  return chain;
}

describe('StateFormPmuReviewHelper', () => {
  let helper: StateFormPmuReviewHelper;

  beforeEach(() => {
    helper = new StateFormPmuReviewHelper();
  });

  describe('transitionForm', () => {
    it('applies $set via findOneAndUpdate and returns the updated document', async () => {
      const formId = new Types.ObjectId();
      const updatedDoc = { _id: formId, currentFormStatus: 15 };
      const query = q(updatedDoc);
      const formModel = { findOneAndUpdate: jest.fn().mockReturnValue(query) };

      const result = await helper.transitionForm({
        formModel: formModel as never,
        formId,
        setFields: { currentFormStatus: 15, auditRevision: 2 },
      });

      expect(formModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: formId },
        { $set: { currentFormStatus: 15, auditRevision: 2 } },
        { new: true },
      );
      expect(result).toBe(updatedDoc);
    });

    it('attaches the session to the query when provided', async () => {
      const formId = new Types.ObjectId();
      const query = q({ _id: formId });
      const formModel = { findOneAndUpdate: jest.fn().mockReturnValue(query) };
      const session = { id: 'fake-session' } as never;

      await helper.transitionForm({
        formModel: formModel as never,
        formId,
        setFields: { currentFormStatus: 15 },
        session,
      });

      expect(query['session']).toHaveBeenCalledWith(session);
    });

    it('does not call .session() when none is provided', async () => {
      const formId = new Types.ObjectId();
      const query = q({ _id: formId });
      const formModel = { findOneAndUpdate: jest.fn().mockReturnValue(query) };

      await helper.transitionForm({ formModel: formModel as never, formId, setFields: {} });

      expect(query['session']).not.toHaveBeenCalled();
    });

    it('throws NotFoundException with the default message when the form vanished', async () => {
      const formId = new Types.ObjectId();
      const formModel = { findOneAndUpdate: jest.fn().mockReturnValue(q(null)) };

      await expect(helper.transitionForm({ formModel: formModel as never, formId, setFields: {} })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('uses the caller-supplied notFoundMessage when given', async () => {
      const formId = new Types.ObjectId();
      const formModel = { findOneAndUpdate: jest.fn().mockReturnValue(q(null)) };

      await expect(
        helper.transitionForm({
          formModel: formModel as never,
          formId,
          setFields: {},
          notFoundMessage: 'SFC Status form not found.',
        }),
      ).rejects.toThrow('SFC Status form not found.');
    });
  });

  describe('writeHistoryIfChanged', () => {
    it('writes one history document via create([doc]) when status actually changes', async () => {
      const historyModel = { create: jest.fn().mockResolvedValue([{}]) };
      const buildDocument = jest.fn().mockReturnValue({ fromStatus: 13, toStatus: 15 });

      await helper.writeHistoryIfChanged({
        historyModel: historyModel as never,
        fromStatus: 13,
        toStatus: 15,
        buildDocument,
      });

      expect(buildDocument).toHaveBeenCalledTimes(1);
      expect(historyModel.create).toHaveBeenCalledWith([{ fromStatus: 13, toStatus: 15 }], undefined);
    });

    it('passes the session through as the create() options when provided', async () => {
      const historyModel = { create: jest.fn().mockResolvedValue([{}]) };
      const session = { id: 'fake-session' } as never;

      await helper.writeHistoryIfChanged({
        historyModel: historyModel as never,
        fromStatus: 13,
        toStatus: 15,
        buildDocument: () => ({}),
        session,
      });

      expect(historyModel.create).toHaveBeenCalledWith([{}], { session });
    });

    it('skips the write entirely when fromStatus === toStatus, matching the SFC/GTC no-op convention', async () => {
      const historyModel = { create: jest.fn() };
      const buildDocument = jest.fn();

      await helper.writeHistoryIfChanged({
        historyModel: historyModel as never,
        fromStatus: 13,
        toStatus: 13,
        buildDocument,
      });

      expect(buildDocument).not.toHaveBeenCalled();
      expect(historyModel.create).not.toHaveBeenCalled();
    });
  });
});
