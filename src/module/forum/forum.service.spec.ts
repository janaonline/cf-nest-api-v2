import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { IAuthUser } from '../../common/interfaces/auth-user.interface';
import { Role } from '../auth/enum/role.enum';
import { ForumAdminService, excerpt } from './forum-admin.service';
import { ForumService } from './forum.service';
import { serializeThread } from './forum.types';
import { boundedHeader, slugify } from './forum.util';

describe('forum.util', () => {
  it('slugifies titles, stripping accents and punctuation', () => {
    expect(slugify('  Héllo, World! 2026 ')).toBe('hello-world-2026');
  });

  it('falls back when nothing usable remains and caps the length', () => {
    expect(slugify('!!!')).toBe('discussion');
    expect(slugify('a'.repeat(200))).toHaveLength(80);
  });

  it('bounds headers and strips line breaks', () => {
    expect(boundedHeader('a\r\nb', 10)).toBe('ab');
    expect(boundedHeader('x'.repeat(100), 5)).toBe('xxxxx');
    expect(boundedHeader(undefined, 5)).toBeNull();
    expect(boundedHeader(['first', 'second'], 10)).toBe('first');
  });
});

describe('ForumService helpers', () => {
  // Only the pure helpers are exercised, so no models are needed.
  const service = new ForumService(...(Array(11).fill(undefined) as ConstructorParameters<typeof ForumService>));
  const owner = new Types.ObjectId();
  const asUser = (_id: Types.ObjectId, role: Role): IAuthUser => ({ _id: _id.toString(), role });

  it('lets the owner and any ADMIN through, and rejects everyone else', () => {
    expect(() => service.assertOwnerOrAdmin(asUser(owner, Role.ULB), owner, 'no')).not.toThrow();
    expect(() => service.assertOwnerOrAdmin(asUser(new Types.ObjectId(), Role.ADMIN), owner, 'no')).not.toThrow();
    expect(() => service.assertOwnerOrAdmin(asUser(new Types.ObjectId(), Role.STATE), owner, 'no')).toThrow(
      ForbiddenException,
    );
  });

  it('turns an invalid id into a 404 with the supplied message', () => {
    expect(() => service.toObjectId('nope', 'Thread not found.')).toThrow(NotFoundException);
    expect(service.toObjectId(owner.toString(), 'x').equals(owner)).toBe(true);
  });

  it('serializes a thread without audit metadata', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const view = serializeThread({
      _id: new Types.ObjectId(),
      title: 't',
      slug: 's',
      body: 'b',
      categoryId: new Types.ObjectId(),
      categorySlug: 'mohua',
      user: { userId: owner, name: 'A', role: 'ULB', ipAddress: '10.0.0.1', userAgentId: new Types.ObjectId() },
      counts: { replies: 1, views: 2, likes: 3, bookmarks: 4 },
      isPublished: true,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
    } as never);
    expect(view.user).toEqual({ userId: owner.toString(), name: 'A', role: 'ULB' });
    expect([view.replyCount, view.viewCount, view.likeCount, view.bookmarkCount]).toEqual([1, 2, 3, 4]);
    expect(JSON.stringify(view)).not.toContain('10.0.0.1');
  });
});

/** Chainable query stub: `.select().lean().exec()` etc. resolve to `value`. */
const query = <T>(value: T) => {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'lean', 'sort', 'limit']) q[m] = () => q;
  q['exec'] = () => Promise.resolve(value);
  return q;
};

describe('ForumService (TS-1305)', () => {
  const ulbId = new Types.ObjectId();
  const userId = new Types.ObjectId();
  const threadId = new Types.ObjectId();
  const commentId = new Types.ObjectId();
  const reporter: IAuthUser = { _id: userId.toString(), role: Role.ULB };

  function build(overrides: { threadVisible?: boolean; comment?: unknown; createError?: unknown } = {}) {
    const threadModel = {
      exists: jest.fn().mockResolvedValue(overrides.threadVisible === false ? null : { _id: threadId }),
    };
    const commentModel = {
      findOne: jest.fn().mockReturnValue(query(overrides.comment ?? null)),
      aggregate: jest.fn(),
    };
    const userModel = {
      findById: jest.fn().mockReturnValue(query({ name: 'Rakesh Sharma', email: 'r@x.org', role: 'ULB', ulb: ulbId })),
      find: jest
        .fn()
        .mockReturnValue(query([{ _id: userId, name: 'Rakesh Sharma', email: 'r@x.org', role: 'ULB', ulb: ulbId }])),
    };
    const ulbModel = {
      findById: jest.fn().mockReturnValue(query({ name: 'Kaithoon Municipality' })),
      find: jest.fn().mockReturnValue(query([{ _id: ulbId, name: 'Kaithoon Municipality' }])),
    };
    const stateModel = { findById: jest.fn().mockReturnValue(query(null)), find: jest.fn().mockReturnValue(query([])) };
    const reportModel = {
      create: overrides.createError
        ? jest.fn().mockRejectedValue(overrides.createError)
        : jest.fn().mockResolvedValue({}),
    };
    const service = new ForumService(
      threadModel as never,
      commentModel as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      userModel as never,
      reportModel as never,
      ulbModel as never,
      stateModel as never,
    );
    return { service, commentModel, reportModel };
  }

  it('reports a visible thread with the reporter ULB name', async () => {
    const { service, reportModel } = build();
    await expect(service.reportPost('thread', threadId.toString(), 'off-topic', reporter)).resolves.toEqual({
      reported: true,
    });
    expect(reportModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        targetType: 'thread',
        reason: 'off-topic',
        status: 'open',
        reporter: expect.objectContaining({ name: 'Kaithoon Municipality', role: 'ULB' }) as unknown,
      }),
    );
  });

  it('rejects a second report of the same post with 409', async () => {
    const { service } = build({ createError: { code: 11000 } });
    await expect(service.reportPost('thread', threadId.toString(), 'other', reporter)).rejects.toThrow(
      ConflictException,
    );
  });

  it('cannot report a hidden thread or a hidden / missing reply', async () => {
    await expect(
      build({ threadVisible: false }).service.reportPost('thread', threadId.toString(), 'other', reporter),
    ).rejects.toThrow(NotFoundException);
    await expect(build().service.reportPost('comment', commentId.toString(), 'other', reporter)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('reports a reply against its thread', async () => {
    const { service, reportModel } = build({ comment: { threadId } });
    await service.reportPost('comment', commentId.toString(), 'personal-details', reporter);
    expect(reportModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ targetType: 'comment', threadId, targetId: commentId }),
    );
  });

  it('collects the ids of posts in a thread the viewer already reported', async () => {
    const { service, reportModel } = build();
    const find = jest.fn().mockReturnValue(query([{ targetId: threadId }, { targetId: commentId }]));
    (reportModel as unknown as { find: jest.Mock }).find = find;
    const ids = await (
      service as unknown as { reportedTargetIds: (u: string, t: Types.ObjectId) => Promise<Set<string>> }
    ).reportedTargetIds(userId.toString(), threadId);
    expect([...ids]).toEqual([threadId.toString(), commentId.toString()]);
    expect(find).toHaveBeenCalledWith({ threadId, 'reporter.userId': userId });
  });

  it('shows the live ULB name on posts that stored the account name, and keeps unknown users as stored', async () => {
    const { service } = build();
    const goneUser = new Types.ObjectId().toString();
    const [oldPost, orphan] = await service.withDisplayNames([
      {
        user: { userId: userId.toString(), name: 'Rakesh Sharma', role: 'ULB' },
        lastReply: { userId: userId.toString(), name: 'Rakesh Sharma', role: 'ULB', createdAt: 'x' },
      },
      { user: { userId: goneUser, name: 'Old Name', role: 'ULB' }, lastReply: null },
    ]);
    expect(oldPost.user.name).toBe('Kaithoon Municipality');
    expect(oldPost.lastReply?.name).toBe('Kaithoon Municipality');
    expect(orphan.user.name).toBe('Old Name');
    expect(orphan.lastReply).toBeNull();
  });

  it('attaches the latest visible reply, or null when there is none', async () => {
    const { service, commentModel } = build();
    const otherThread = new Types.ObjectId();
    const at = new Date('2026-11-20T10:00:00Z');
    commentModel.aggregate.mockReturnValue(
      query([{ _id: threadId, userId, name: 'State DMA, Punjab', role: 'STATE', createdAt: at }]),
    );
    const threads = [{ id: threadId.toString() }, { id: otherThread.toString() }] as never[];
    const result = await (
      service as unknown as { attachLastReplies: (t: never[]) => Promise<{ lastReply: unknown }[]> }
    ).attachLastReplies(threads);
    expect(result[0].lastReply).toEqual({
      userId: userId.toString(),
      name: 'State DMA, Punjab',
      role: 'STATE',
      createdAt: at.toISOString(),
    });
    expect(result[1].lastReply).toBeNull();
    const calls = commentModel.aggregate.mock.calls as unknown as [{ $match?: { deletedAt?: unknown } }[]][];
    const pipeline = calls[0][0];
    expect(pipeline[0].$match?.deletedAt).toBeNull();
  });
});

describe('ForumAdminService reports (TS-1305)', () => {
  const admin: IAuthUser = { _id: new Types.ObjectId().toString(), role: Role.ADMIN };
  const reportId = new Types.ObjectId();
  const targetId = new Types.ObjectId();

  function build(report: Record<string, unknown> | null, comment: unknown = { deletedAt: null }) {
    const reportModel = {
      findOne: jest.fn().mockReturnValue(query(report)),
      updateOne: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({}),
    };
    const forum = {
      reportModel,
      toObjectId: (v: string) => new Types.ObjectId(v),
      commentModel: { findById: jest.fn().mockReturnValue(query(comment)) },
    };
    const service = new ForumAdminService(forum as never);
    const moderateThread = jest.spyOn(service, 'moderateThread').mockResolvedValue({} as never);
    const moderateComment = jest.spyOn(service, 'moderateComment').mockResolvedValue();
    return { service, reportModel, moderateThread, moderateComment };
  }

  it('hide unpublishes a reported thread and resolves all its open reports', async () => {
    const { service, reportModel, moderateThread } = build({ _id: reportId, targetType: 'thread', targetId });
    await service.resolveReport(reportId.toString(), 'hide', admin);
    expect(moderateThread).toHaveBeenCalledWith(targetId.toString(), { isPublished: false }, admin);
    expect(reportModel.updateMany).toHaveBeenCalledWith(
      { targetType: 'thread', targetId, status: 'open' },
      { $set: expect.objectContaining({ status: 'hidden' }) as unknown },
    );
  });

  it('hide soft-deletes a reported reply', async () => {
    const { service, moderateComment } = build({ _id: reportId, targetType: 'comment', targetId });
    await service.resolveReport(reportId.toString(), 'hide', admin);
    expect(moderateComment).toHaveBeenCalledWith(targetId.toString(), { isDeleted: true }, admin);
  });

  it('dismiss resolves only this report and keeps the post', async () => {
    const { service, reportModel, moderateThread } = build({ _id: reportId, targetType: 'thread', targetId });
    await service.resolveReport(reportId.toString(), 'dismiss', admin);
    expect(moderateThread).not.toHaveBeenCalled();
    expect(reportModel.updateMany).not.toHaveBeenCalled();
    expect(reportModel.updateOne).toHaveBeenCalledWith(
      { _id: reportId },
      { $set: expect.objectContaining({ status: 'dismissed' }) as unknown },
    );
  });

  it('404s on a report that is missing or already resolved', async () => {
    await expect(build(null).service.resolveReport(reportId.toString(), 'dismiss', admin)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('builds a plain-text excerpt', () => {
    expect(excerpt('## Hello <b>world</b>\n\n**bold**')).toBe('Hello world bold');
    expect(excerpt('x'.repeat(300))).toHaveLength(160);
  });
});
