import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { IAuthUser } from '../../common/interfaces/auth-user.interface';
import { Role } from '../auth/enum/role.enum';
import { ForumService } from './forum.service';

/** Chainable query stub: any of the query builder methods resolve to `value`. */
const query = <T>(value: T) => {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'lean', 'sort', 'limit']) q[m] = () => q;
  q['exec'] = () => Promise.resolve(value);
  q['distinct'] = () => Promise.resolve(value);
  q['then'] = (resolve: (v: T) => unknown) => Promise.resolve(value).then(resolve);
  return q;
};

type Mock = Record<string, jest.Mock>;

function build(models: {
  thread?: Mock;
  comment?: Mock;
  category?: Mock;
  like?: Mock;
  bookmark?: Mock;
  user?: Mock;
  ulb?: Mock;
  state?: Mock;
}) {
  const service = new ForumService(
    (models.thread ?? {}) as never,
    (models.comment ?? {}) as never,
    (models.category ?? {}) as never,
    (models.like ?? {}) as never,
    (models.bookmark ?? {}) as never,
    {} as never,
    {} as never,
    (models.user ?? {}) as never,
    {} as never,
    (models.ulb ?? {}) as never,
    (models.state ?? {}) as never,
  );
  return service;
}

const user: IAuthUser = { _id: new Types.ObjectId().toString(), role: Role.ULB };

describe('ForumService review fixes', () => {
  it('only inserts missing canonical categories; existing ones keep ADMIN edits', async () => {
    const category = { updateOne: jest.fn().mockResolvedValue({}) };
    await build({ category }).onModuleInit();
    for (const [, update] of category.updateOne.mock.calls as [unknown, Record<string, unknown>][]) {
      expect(update['$set']).toBeUndefined();
      expect(update['$setOnInsert']).toEqual(
        expect.objectContaining({
          name: expect.any(String) as unknown,
          description: expect.any(String) as unknown,
        }) as unknown,
      );
    }
  });

  it('refuses a reply to an unpublished or deleted thread', async () => {
    const thread = { exists: jest.fn().mockResolvedValue(null) };
    const service = build({ thread });
    await expect(
      service.addComment(new Types.ObjectId().toString(), { body: 'hello' }, user, {
        ipAddress: null,
        userAgent: null,
      }),
    ).rejects.toThrow(NotFoundException);
    expect(thread.exists).toHaveBeenCalledWith(
      expect.objectContaining({ isPublished: { $ne: false }, deletedAt: null }),
    );
  });

  describe('comment delete / restore batches', () => {
    const id = new Types.ObjectId();
    const threadId = new Types.ObjectId();

    it('soft-delete stamps one shared deletionBatch on the comments it removes', async () => {
      const comment = {
        find: jest.fn().mockReturnValue(query([])),
        updateMany: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      };
      const thread = { updateOne: jest.fn().mockResolvedValue({}) };
      await build({ comment, thread }).softDeleteComment(id, threadId, user._id);
      const [filter, update] = comment.updateMany.mock.calls[0] as [
        Record<string, unknown>,
        { $set: Record<string, unknown> },
      ];
      expect(filter['deletedAt']).toBeNull(); // already-deleted replies keep their own batch
      expect(update.$set['deletionBatch']).toBeInstanceOf(Types.ObjectId);
    });

    it('restore brings back only the batch that removed this comment', async () => {
      const batch = new Types.ObjectId();
      const comment = {
        findById: jest.fn().mockReturnValue(query({ deletedAt: new Date(), deletionBatch: batch })),
        find: jest.fn().mockReturnValue(query([])),
        updateMany: jest.fn().mockResolvedValue({ modifiedCount: 2 }),
      };
      const thread = { updateOne: jest.fn().mockResolvedValue({}) };
      await build({ comment, thread }).restoreComment(id, threadId);
      const [filter] = comment.updateMany.mock.calls[0] as [Record<string, unknown>];
      expect(filter['deletionBatch']).toBe(batch);
    });

    it('restore of a comment deleted before batches existed matches its delete timestamp', async () => {
      const deletedAt = new Date('2026-11-01T10:00:00Z');
      const comment = {
        findById: jest.fn().mockReturnValue(query({ deletedAt, deletionBatch: null })),
        find: jest.fn().mockReturnValue(query([])),
        updateMany: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      };
      const thread = { updateOne: jest.fn().mockResolvedValue({}) };
      await build({ comment, thread }).restoreComment(id, threadId);
      const [filter] = comment.updateMany.mock.calls[0] as [Record<string, unknown>];
      expect(filter).toEqual(expect.objectContaining({ deletionBatch: null, deletedAt }));
    });
  });

  describe('like / bookmark counters', () => {
    const threadId = new Types.ObjectId().toString();

    it('adds exactly the inserted membership to the bookmark count, atomically', async () => {
      const thread = {
        exists: jest.fn().mockResolvedValue({ _id: threadId }),
        findOneAndUpdate: jest.fn().mockReturnValue(query({ counts: { bookmarks: 3 } })),
      };
      const bookmark = { updateOne: jest.fn().mockResolvedValue({ upsertedCount: 1 }), countDocuments: jest.fn() };
      const result = await build({ thread, bookmark }).reactToThread(threadId, 'bookmark', true, user);
      expect(result.bookmarkCount).toBe(3);
      const [, update] = thread.findOneAndUpdate.mock.calls[0] as [unknown, unknown];
      expect(update).toEqual({ $inc: { 'counts.bookmarks': 1 } });
      expect(bookmark.countDocuments).not.toHaveBeenCalled(); // no read-then-overwrite
    });

    it('applies an unlike without clamping, and repairs a negative (drifted) count by recounting', async () => {
      const thread = {
        exists: jest.fn().mockResolvedValue({ _id: threadId }),
        findOneAndUpdate: jest.fn().mockReturnValue(query({ counts: { likes: -1 } })),
        updateOne: jest.fn().mockResolvedValue({}),
      };
      const like = {
        deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
        countDocuments: jest.fn().mockResolvedValue(0),
      };
      const result = await build({ thread, like }).reactToThread(threadId, 'like', false, user);
      const [, update] = thread.findOneAndUpdate.mock.calls[0] as [unknown, unknown];
      expect(update).toEqual({ $inc: { 'counts.likes': -1 } });
      expect(thread.updateOne).toHaveBeenCalledWith(expect.anything(), { $set: { 'counts.likes': 0 } });
      expect(result.likeCount).toBe(0);
    });

    it('a repeated like (no new membership) does not change the count', async () => {
      const thread = {
        exists: jest.fn().mockResolvedValue({ _id: threadId }),
        findOneAndUpdate: jest.fn().mockReturnValue(query({ counts: { likes: 4 } })),
      };
      const like = { updateOne: jest.fn().mockRejectedValue({ code: 11000 }) };
      const result = await build({ thread, like }).reactToThread(threadId, 'like', true, user);
      const [, update] = thread.findOneAndUpdate.mock.calls[0] as [unknown, unknown];
      expect(update).toEqual({ $inc: { 'counts.likes': 0 } });
      expect(result.likeCount).toBe(4);
    });
  });

  it('search matches the displayed author name, and stored names only for deleted accounts', async () => {
    const ulbId = new Types.ObjectId();
    const ulbAuthor = new Types.ObjectId();
    const goneAuthor = new Types.ObjectId();
    const thread = { distinct: jest.fn().mockResolvedValue([goneAuthor]) };
    const ulb = {
      find: jest.fn().mockReturnValue(query([ulbId])),
    };
    const state = { find: jest.fn().mockReturnValue(query([])) };
    const userModel = {
      find: jest
        .fn()
        // 1) candidate authors, 2) displayNames lookup, 3) which stored-name authors still exist
        .mockReturnValueOnce(query([ulbAuthor]))
        .mockReturnValueOnce(query([{ _id: ulbAuthor, name: 'Rakesh Sharma', role: 'ULB', ulb: ulbId }]))
        .mockReturnValueOnce(query([])),
    };
    ulb.find
      .mockReturnValueOnce(query([ulbId])) // ULBs whose name matches
      .mockReturnValueOnce(query([{ _id: ulbId, name: 'Kaithoon Municipality' }])); // displayNames
    const service = build({ thread, ulb, state, user: userModel });
    const result = await (
      service as unknown as {
        authorsMatching: (p: RegExp) => Promise<{ live: Types.ObjectId[]; orphaned: Types.ObjectId[] }>;
      }
    ).authorsMatching(/kaithoon/i);
    expect(result.live.map(String)).toEqual([String(ulbAuthor)]);
    expect(result.orphaned.map(String)).toEqual([String(goneAuthor)]);
  });
});
