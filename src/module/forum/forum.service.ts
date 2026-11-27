import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { FORUM_DB_CONNECTION } from '../../core/database/forum-db.module';
import { escapeRegex } from '../../common/utils/regex.util';
import type { IAuthUser } from '../../common/interfaces/auth-user.interface';
import { ForumBookmark } from '../../schemas/forum/forum-bookmark.schema';
import { ForumCategory } from '../../schemas/forum/forum-category.schema';
import { ForumComment } from '../../schemas/forum/forum-comment.schema';
import { ForumLike, ForumLikeTargetType } from '../../schemas/forum/forum-like.schema';
import { ForumThread } from '../../schemas/forum/forum-thread.schema';
import { ForumThreadView as ForumThreadViewDoc } from '../../schemas/forum/forum-thread-view.schema';
import { ForumUserAgent } from '../../schemas/forum/forum-user-agent.schema';
import { ForumReport, ForumReportReason, ForumReportTargetType } from '../../schemas/forum/forum-report.schema';
import { State } from '../../schemas/state.schema';
import { Ulb } from '../../schemas/ulb.schema';
import { User } from '../../schemas/user/user.schema';
import {
  FORUM_MOHUA_NAME,
  FORUM_STATE_ROLES,
  FORUM_ULB_ROLES,
  resolveForumDisplayName,
} from '../../common/utils/forum-display-name.util';
import { Role } from '../auth/enum/role.enum';
import { CreateCommentDto, CreateThreadDto, UpdateThreadDto } from './dto/forum.dto';
import { FORUM_CATEGORIES, FORUM_CATEGORY_SLUGS, FORUM_THREAD_LIST_LIMIT } from './forum.constants';
import {
  ForumCategoryView,
  ForumCommentView,
  ForumLastReply,
  ForumPublicUser,
  ForumRequestMetadata,
  ForumThreadView,
  serializeCategory,
  serializeComment,
  serializeThread,
} from './forum.types';
import { slugify } from './forum.util';

const VISIBLE_THREAD: FilterQuery<ForumThread> = { isPublished: { $ne: false }, deletedAt: null };

/** Mongo duplicate-key error code. */
const DUPLICATE_KEY = 11000;
const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: number }).code === DUPLICATE_KEY;

@Injectable()
export class ForumService implements OnModuleInit {
  private readonly logger = new Logger(ForumService.name);

  constructor(
    @InjectModel(ForumThread.name, FORUM_DB_CONNECTION) readonly threadModel: Model<ForumThread>,
    @InjectModel(ForumComment.name, FORUM_DB_CONNECTION) readonly commentModel: Model<ForumComment>,
    @InjectModel(ForumCategory.name, FORUM_DB_CONNECTION) readonly categoryModel: Model<ForumCategory>,
    @InjectModel(ForumLike.name, FORUM_DB_CONNECTION) private readonly likeModel: Model<ForumLike>,
    @InjectModel(ForumBookmark.name, FORUM_DB_CONNECTION) private readonly bookmarkModel: Model<ForumBookmark>,
    @InjectModel(ForumThreadViewDoc.name, FORUM_DB_CONNECTION) private readonly viewModel: Model<ForumThreadViewDoc>,
    @InjectModel(ForumUserAgent.name, FORUM_DB_CONNECTION) private readonly userAgentModel: Model<ForumUserAgent>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(ForumReport.name, FORUM_DB_CONNECTION) readonly reportModel: Model<ForumReport>,
    @InjectModel(Ulb.name) private readonly ulbModel: Model<Ulb>,
    @InjectModel(State.name) private readonly stateModel: Model<State>,
  ) {}

  /**
   * Inserts any missing canonical category. An existing one is left exactly as it is, so an ADMIN's
   * edits to its name or description survive restarts.
   */
  async onModuleInit(): Promise<void> {
    const now = new Date();
    try {
      await Promise.all(
        FORUM_CATEGORIES.map((c) =>
          this.categoryModel.updateOne(
            { slug: c.slug },
            { $setOnInsert: { name: c.name, description: c.description, createdAt: now } },
            { upsert: true },
          ),
        ),
      );
    } catch (error) {
      this.logger.error(`Failed to seed forum categories: ${(error as Error).message}`);
    }
  }

  // ---------------------------------------------------------------- categories

  async listCategories(): Promise<ForumCategoryView[]> {
    const categories = await this.categoryModel.find().lean().exec();
    const order = (slug: string) => {
      const index = FORUM_CATEGORY_SLUGS.indexOf(slug);
      return index === -1 ? FORUM_CATEGORY_SLUGS.length : index;
    };
    return categories
      .map((c) => serializeCategory(c as never))
      .sort((a, b) => order(a.slug) - order(b.slug) || a.name.localeCompare(b.name));
  }

  // ------------------------------------------------------------------- threads

  async listThreads(user: IAuthUser, categorySlug?: string, query?: string): Promise<ForumThreadView[]> {
    const filter: FilterQuery<ForumThread> = { ...VISIBLE_THREAD, ...(categorySlug ? { categorySlug } : {}) };
    const search = query?.trim();
    if (search) {
      const pattern = new RegExp(escapeRegex(search), 'i');
      const [commentThreadIds, authors] = await Promise.all([
        this.commentModel.distinct('threadId', { body: pattern, deletedAt: null }),
        this.authorsMatching(pattern),
      ]);
      filter.$or = [
        { title: pattern },
        { body: pattern },
        { categorySlug: pattern },
        { 'user.userId': { $in: authors.live } },
        { 'user.userId': { $in: authors.orphaned }, 'user.name': pattern },
        { _id: { $in: commentThreadIds } },
      ];
    }
    const threads = await this.threadModel
      .find(filter)
      .sort({ lastActivityAt: -1 })
      .limit(FORUM_THREAD_LIST_LIMIT)
      .lean()
      .exec();
    return this.decorateThreads(
      threads.map((t) => serializeThread(t as never)),
      user,
    );
  }

  async listMyThreads(user: IAuthUser): Promise<ForumThreadView[]> {
    const threads = await this.threadModel
      .find({ 'user.userId': new Types.ObjectId(user._id), ...VISIBLE_THREAD })
      .sort({ lastActivityAt: -1 })
      .limit(FORUM_THREAD_LIST_LIMIT)
      .lean()
      .exec();
    return this.decorateThreads(
      threads.map((t) => serializeThread(t as never)),
      user,
    );
  }

  async listSavedThreads(user: IAuthUser): Promise<ForumThreadView[]> {
    const bookmarks = await this.bookmarkModel
      .find({ userId: new Types.ObjectId(user._id) })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    const ids = bookmarks.map((b) => b.threadId);
    if (!ids.length) return [];
    const threads = await this.threadModel
      .find({ _id: { $in: ids }, ...VISIBLE_THREAD })
      .lean()
      .exec();
    const order = new Map(ids.map((id, index) => [id.toString(), index]));
    const sorted = threads
      .map((t) => serializeThread(t as never))
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    return this.decorateThreads(sorted, user);
  }

  /** Thread detail for the signed-in user; counts the view once per (thread, user). */
  async getThreadDetail(
    slug: string,
    user: IAuthUser,
  ): Promise<{ thread: ForumThreadView; comments: ForumCommentView[] }> {
    const doc = await this.threadModel
      .findOne({ slug, ...VISIBLE_THREAD })
      .lean()
      .exec();
    if (!doc) throw new NotFoundException('Thread not found.');
    const thread = serializeThread(doc as never);
    const threadId = doc._id;
    const [viewCount, comments, likedThreadIds, bookmarkedThreadIds, reportedIds] = await Promise.all([
      this.recordUniqueView(threadId, new Types.ObjectId(user._id)),
      this.commentModel.find({ threadId, deletedAt: null }).sort({ createdAt: 1 }).lean().exec(),
      this.likedTargetIds(user._id, 'thread', [thread.id]),
      this.bookmarkedThreadIds(user._id, [thread.id]),
      this.reportedTargetIds(user._id, threadId),
    ]);
    // One display-name lookup for the thread author and every reply author.
    const names = await this.displayNames([thread.user.userId, ...comments.map((c) => c.user.userId.toString())]);
    const named = <T extends { user: ForumPublicUser }>(v: T): T => ({
      ...v,
      user: { ...v.user, name: names.get(v.user.userId) ?? v.user.name },
    });
    thread.user = named(thread).user;
    const serializedComments = comments.map((c) => named(serializeComment(c as never)));
    const likedCommentIds = new Set(
      await this.likedTargetIds(
        user._id,
        'comment',
        serializedComments.map((c) => c.id),
      ),
    );
    return {
      thread: {
        ...thread,
        viewCount,
        liked: likedThreadIds.length > 0,
        bookmarked: bookmarkedThreadIds.length > 0,
        reported: reportedIds.has(thread.id),
      },
      comments: serializedComments.map((c) => ({
        ...c,
        liked: likedCommentIds.has(c.id),
        reported: reportedIds.has(c.id),
      })),
    };
  }

  /** Ids of the thread and its replies that this user has already reported (any status — one report per item). */
  private async reportedTargetIds(userId: string, threadId: Types.ObjectId): Promise<Set<string>> {
    const reports = await this.reportModel
      .find({ threadId, 'reporter.userId': new Types.ObjectId(userId) })
      .select('targetId')
      .lean()
      .exec();
    return new Set(reports.map((r) => r.targetId.toString()));
  }

  async createThread(dto: CreateThreadDto, author: IAuthUser, meta: ForumRequestMetadata): Promise<ForumThreadView> {
    const category = await this.categoryModel.findOne({ slug: dto.categorySlug }).lean().exec();
    if (!category) throw new BadRequestException('That category does not exist.');
    const base = slugify(dto.title);
    const now = new Date();
    const embeddedUser = await this.embeddedUser(author, meta);
    for (let suffix = 1; ; suffix += 1) {
      const slug = suffix === 1 ? base : `${base}-${suffix}`;
      try {
        const created = await this.threadModel.create({
          title: dto.title,
          body: dto.body,
          slug,
          categoryId: category._id,
          categorySlug: category.slug,
          user: embeddedUser,
          counts: { replies: 0, views: 0, likes: 0, bookmarks: 0 },
          isPublished: true,
          deletedAt: null,
          deletedBy: null,
          createdAt: now,
          updatedAt: now,
          lastActivityAt: now,
        });
        return serializeThread(created.toObject() as never);
      } catch (error) {
        // The unique slug index is the arbiter — a concurrent create with the same title just takes the next suffix.
        if (!isDuplicateKey(error)) throw error;
      }
    }
  }

  async editThread(threadId: string, dto: UpdateThreadDto, user: IAuthUser): Promise<ForumThreadView> {
    const thread = await this.requireThread(threadId);
    this.assertOwnerOrAdmin(user, thread.user.userId, 'You cannot edit this thread.');
    const set: Partial<ForumThread> = {};
    if (dto.title !== undefined) set.title = dto.title;
    if (dto.body !== undefined) set.body = dto.body;
    if (dto.categorySlug !== undefined) {
      const category = await this.categoryModel.findOne({ slug: dto.categorySlug }).lean().exec();
      if (!category) throw new BadRequestException('That category does not exist.');
      set.categorySlug = category.slug;
      set.categoryId = category._id;
    }
    const updated = await this.threadModel
      .findByIdAndUpdate(thread._id, { $set: { ...set, updatedAt: new Date() } }, { new: true })
      .lean()
      .exec();
    if (!updated) throw new NotFoundException('Thread not found.');
    const [view] = await this.withDisplayNames([serializeThread(updated as never)]);
    return view;
  }

  async deleteThread(threadId: string, user: IAuthUser): Promise<void> {
    const thread = await this.requireThread(threadId);
    this.assertOwnerOrAdmin(user, thread.user.userId, 'You cannot delete this thread.');
    await this.threadModel.updateOne(
      { _id: thread._id },
      {
        $set: {
          isPublished: false,
          deletedAt: new Date(),
          deletedBy: new Types.ObjectId(user._id),
          updatedAt: new Date(),
        },
      },
    );
  }

  // ---------------------------------------------------------------- reactions

  async reactToThread(
    threadId: string,
    reaction: 'like' | 'bookmark',
    active: boolean,
    user: IAuthUser,
  ): Promise<{ active: boolean; likeCount?: number; bookmarkCount?: number }> {
    const id = this.toObjectId(threadId, 'Thread not found.');
    if (reaction === 'like') {
      const result = await this.setLike(user._id, 'thread', id, active);
      return { active, likeCount: result };
    }
    const visible = await this.threadModel.exists({ _id: id, ...VISIBLE_THREAD });
    if (!visible) throw new NotFoundException('Thread not found.');
    return { active, bookmarkCount: await this.setBookmark(user._id, id, active) };
  }

  async likeComment(
    commentId: string,
    active: boolean,
    user: IAuthUser,
  ): Promise<{ active: boolean; likeCount: number }> {
    const id = this.toObjectId(commentId, 'Comment not found.');
    return { active, likeCount: await this.setLike(user._id, 'comment', id, active) };
  }

  // ------------------------------------------------------------------ reports

  /** Reports a visible thread or reply for ADMIN review; one report per user per item (409 on repeat). */
  async reportPost(
    targetType: ForumReportTargetType,
    targetId: string,
    reason: ForumReportReason,
    user: IAuthUser,
  ): Promise<{ reported: true }> {
    const notFound = targetType === 'thread' ? 'Thread not found.' : 'Comment not found.';
    const id = this.toObjectId(targetId, notFound);
    let threadId: Types.ObjectId;
    if (targetType === 'thread') {
      if (!(await this.threadModel.exists({ _id: id, ...VISIBLE_THREAD }))) throw new NotFoundException(notFound);
      threadId = id;
    } else {
      const comment = await this.commentModel.findOne({ _id: id, deletedAt: null }).select('threadId').lean().exec();
      if (!comment || !(await this.threadModel.exists({ _id: comment.threadId, ...VISIBLE_THREAD }))) {
        throw new NotFoundException(notFound);
      }
      threadId = comment.threadId;
    }
    const reporter = await this.userIdentity(user._id);
    try {
      await this.reportModel.create({
        targetType,
        targetId: id,
        threadId,
        reason,
        reporter: { userId: new Types.ObjectId(user._id), name: reporter.name, role: reporter.role ?? user.role },
        status: 'open',
        createdAt: new Date(),
      });
    } catch (error) {
      if (isDuplicateKey(error)) throw new ConflictException('You have already reported this post.');
      throw error;
    }
    return { reported: true };
  }

  // ----------------------------------------------------------------- comments

  async addComment(
    threadId: string,
    dto: CreateCommentDto,
    author: IAuthUser,
    meta: ForumRequestMetadata,
  ): Promise<ForumCommentView> {
    const id = this.toObjectId(threadId, 'Thread not found.');
    // Unpublished or deleted threads take no replies (nor counter / activity updates).
    if (!(await this.threadModel.exists({ _id: id, ...VISIBLE_THREAD }))) {
      throw new NotFoundException('Thread not found.');
    }
    let parentId: Types.ObjectId | undefined;
    if (dto.parentId) {
      parentId = new Types.ObjectId(dto.parentId);
      const parent = await this.commentModel.findOne({ _id: parentId, deletedAt: null }).lean().exec();
      if (!parent || !parent.threadId.equals(id)) {
        throw new NotFoundException('The comment you are replying to was not found.');
      }
      if (parent.parentId) {
        const grandparent = await this.commentModel.findOne({ _id: parent.parentId, deletedAt: null }).lean().exec();
        if (!grandparent || grandparent.parentId)
          throw new BadRequestException('Replies can only be nested to level 2.');
      }
    }
    const now = new Date();
    const created = await this.commentModel.create({
      threadId: id,
      parentId,
      body: dto.body,
      user: await this.embeddedUser(author, meta),
      counts: { likes: 0 },
      createdAt: now,
      updatedAt: now,
    });
    await this.threadModel.updateOne(
      { _id: id },
      { $inc: { 'counts.replies': 1 }, $set: { lastActivityAt: now, updatedAt: now } },
    );
    return serializeComment(created.toObject() as never);
  }

  /** Soft-deletes the comment and its (up to two levels of) descendants; the author or an ADMIN may do this. */
  async deleteComment(commentId: string, user: IAuthUser): Promise<void> {
    const id = this.toObjectId(commentId, 'Comment not found.');
    const comment = await this.commentModel.findOne({ _id: id, deletedAt: null }).lean().exec();
    if (!comment) throw new NotFoundException('Comment not found.');
    this.assertOwnerOrAdmin(user, comment.user.userId, 'You cannot delete this comment.');
    await this.softDeleteComment(comment._id, comment.threadId, user._id);
  }

  /**
   * Soft-deletes the comment and its still-visible replies as one batch (one `deletionBatch` id).
   * Replies that were already deleted keep their own batch.
   */
  async softDeleteComment(id: Types.ObjectId, threadId: Types.ObjectId, deletedBy: string): Promise<void> {
    const ids = await this.commentTreeIds(id);
    const now = new Date();
    const result = await this.commentModel.updateMany(
      { _id: { $in: ids }, deletedAt: null },
      {
        $set: {
          deletedAt: now,
          deletedBy: new Types.ObjectId(deletedBy),
          deletionBatch: new Types.ObjectId(),
          updatedAt: now,
        },
      },
    );
    if (result.modifiedCount) await this.adjustReplies(threadId, -result.modifiedCount);
  }

  /**
   * Undoes the soft-delete that removed this comment: restores the comment and only the replies
   * removed in the same batch. A reply deleted on its own (before or after) stays deleted.
   */
  async restoreComment(id: Types.ObjectId, threadId: Types.ObjectId): Promise<void> {
    const target = await this.commentModel.findById(id).select('deletedAt deletionBatch').lean().exec();
    if (!target?.deletedAt) return;
    const ids = await this.commentTreeIds(id);
    // Comments deleted before `deletionBatch` existed: one delete wrote one `deletedAt` to its whole
    // batch, so that timestamp identifies the batch.
    const sameBatch: FilterQuery<ForumComment> = target.deletionBatch
      ? { deletionBatch: target.deletionBatch }
      : { deletionBatch: null, deletedAt: target.deletedAt };
    const result = await this.commentModel.updateMany(
      { _id: { $in: ids }, ...sameBatch },
      { $set: { deletedAt: null, deletedBy: null, deletionBatch: null, updatedAt: new Date() } },
    );
    if (result.modifiedCount) await this.adjustReplies(threadId, result.modifiedCount);
  }

  // ------------------------------------------------------------------ helpers

  toObjectId(value: string, notFoundMessage: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(value)) throw new NotFoundException(notFoundMessage);
    return new Types.ObjectId(value);
  }

  assertOwnerOrAdmin(user: IAuthUser, ownerId: Types.ObjectId, message: string): void {
    if (user.role !== Role.ADMIN && ownerId.toString() !== user._id) throw new ForbiddenException(message);
  }

  private async requireThread(threadId: string) {
    const id = this.toObjectId(threadId, 'Thread not found.');
    const thread = await this.threadModel.findById(id).lean().exec();
    if (!thread) throw new NotFoundException('Thread not found.');
    return thread;
  }

  /** The comment plus all its children and grandchildren, deleted or not (callers filter by state). */
  private async commentTreeIds(id: Types.ObjectId): Promise<Types.ObjectId[]> {
    const children = await this.commentModel.find({ parentId: id }).distinct('_id');
    const grandchildren = children.length
      ? await this.commentModel.find({ parentId: { $in: children } }).distinct('_id')
      : [];
    return [id, ...children, ...grandchildren] as Types.ObjectId[];
  }

  private async adjustReplies(threadId: Types.ObjectId, delta: number): Promise<void> {
    // Never let the counter go negative, whatever the drift.
    await this.threadModel.updateOne({ _id: threadId }, [
      { $set: { 'counts.replies': { $max: [0, { $add: [{ $ifNull: ['$counts.replies', 0] }, delta] }] } } },
    ]);
  }

  private async withViewerFlags(threads: ForumThreadView[], user: IAuthUser): Promise<ForumThreadView[]> {
    const ids = threads.map((t) => t.id);
    const [liked, bookmarked] = await Promise.all([
      this.likedTargetIds(user._id, 'thread', ids),
      this.bookmarkedThreadIds(user._id, ids),
    ]);
    const likedSet = new Set(liked);
    const bookmarkedSet = new Set(bookmarked);
    return threads.map((t) => ({ ...t, liked: likedSet.has(t.id), bookmarked: bookmarkedSet.has(t.id) }));
  }

  private async likedTargetIds(userId: string, targetType: ForumLikeTargetType, ids: string[]): Promise<string[]> {
    if (!ids.length) return [];
    const likes = await this.likeModel
      .find({
        userId: new Types.ObjectId(userId),
        targetType,
        targetId: { $in: ids.map((i) => new Types.ObjectId(i)) },
      })
      .select('targetId')
      .lean()
      .exec();
    return likes.map((l) => l.targetId.toString());
  }

  private async bookmarkedThreadIds(userId: string, ids: string[]): Promise<string[]> {
    if (!ids.length) return [];
    const bookmarks = await this.bookmarkModel
      .find({ userId: new Types.ObjectId(userId), threadId: { $in: ids.map((i) => new Types.ObjectId(i)) } })
      .select('threadId')
      .lean()
      .exec();
    return bookmarks.map((b) => b.threadId.toString());
  }

  private async setLike(
    userId: string,
    targetType: ForumLikeTargetType,
    targetId: Types.ObjectId,
    active: boolean,
  ): Promise<number> {
    const model = (targetType === 'thread' ? this.threadModel : this.commentModel) as Model<ForumThread | ForumComment>;
    const targetFilter =
      targetType === 'thread' ? { _id: targetId, ...VISIBLE_THREAD } : { _id: targetId, deletedAt: null };
    if (!(await model.exists(targetFilter))) {
      throw new NotFoundException(targetType === 'thread' ? 'Thread not found.' : 'Comment not found.');
    }
    const key = { userId: new Types.ObjectId(userId), targetType, targetId };
    const delta = await this.applyMembership(this.likeModel as Model<unknown>, key, active);
    const count = await this.incrementCounter(model, { _id: targetId }, 'counts.likes', delta, () =>
      this.likeModel.countDocuments({ targetType, targetId }),
    );
    if (count === null) {
      throw new NotFoundException(targetType === 'thread' ? 'Thread not found.' : 'Comment not found.');
    }
    return count;
  }

  private async setBookmark(userId: string, threadId: Types.ObjectId, active: boolean): Promise<number> {
    const key = { userId: new Types.ObjectId(userId), threadId };
    const delta = await this.applyMembership(this.bookmarkModel as Model<unknown>, key, active);
    const count = await this.incrementCounter(this.threadModel, { _id: threadId }, 'counts.bookmarks', delta, () =>
      this.bookmarkModel.countDocuments({ threadId }),
    );
    if (count === null) throw new NotFoundException('Thread not found.');
    return count;
  }

  /**
   * Adds or removes one like / bookmark membership and returns exactly what changed: +1 inserted,
   * -1 removed, 0 when it was already in that state (including a concurrent duplicate insert).
   */
  private async applyMembership(model: Model<unknown>, key: object, active: boolean): Promise<number> {
    if (!active) return -(await model.deleteOne(key)).deletedCount;
    try {
      const result = await model.updateOne(key, { $setOnInsert: { createdAt: new Date() } }, { upsert: true });
      return result.upsertedCount;
    } catch (error) {
      if (!isDuplicateKey(error)) throw error; // a concurrent request by the same user inserted it first
      return 0;
    }
  }

  /**
   * Applies a membership change to its counter in one atomic `$inc`, so every successful change is
   * counted exactly once however requests overlap, and returns the new value (null if the target is
   * gone). No clamp: it would discard real decrements. A negative result can only come from drift
   * in old data, and is repaired by recounting the memberships.
   */
  private async incrementCounter<T>(
    model: Model<T>,
    filter: FilterQuery<T>,
    path: 'counts.likes' | 'counts.bookmarks',
    delta: number,
    recount: () => Promise<number>,
  ): Promise<number | null> {
    const updated = await model
      .findOneAndUpdate(filter, { $inc: { [path]: delta } } as never, { new: true, projection: { counts: 1 } })
      .lean()
      .exec();
    if (!updated) return null;
    const counts = (updated as { counts?: Record<string, number> }).counts ?? {};
    const value = counts[path.split('.')[1]] ?? 0;
    if (value >= 0) return value;
    const actual = await recount();
    await model.updateOne(filter, { $set: { [path]: actual } } as never);
    return actual;
  }

  private async recordUniqueView(threadId: Types.ObjectId, userId: Types.ObjectId): Promise<number> {
    let isNewView = false;
    try {
      const result = await this.viewModel.updateOne(
        { threadId, userId },
        { $setOnInsert: { createdAt: new Date() } },
        { upsert: true },
      );
      isNewView = result.upsertedCount === 1;
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
    }
    const thread = await this.threadModel
      .findOneAndUpdate({ _id: threadId, ...VISIBLE_THREAD }, isNewView ? { $inc: { 'counts.views': 1 } } : {}, {
        new: true,
        projection: { counts: 1 },
      })
      .lean()
      .exec();
    if (!thread) throw new NotFoundException('Thread not found.');
    return thread.counts?.views ?? 0;
  }

  /** Last post, then live display names, then the viewer's like/bookmark flags — for every thread list. */
  private async decorateThreads(threads: ForumThreadView[], user: IAuthUser): Promise<ForumThreadView[]> {
    return this.withViewerFlags(await this.withDisplayNames(await this.attachLastReplies(threads)), user);
  }

  /** Adds the latest visible reply of each thread (TS-1305 "Last post"); one aggregation for the whole page. */
  private async attachLastReplies(threads: ForumThreadView[]): Promise<ForumThreadView[]> {
    if (!threads.length) return threads;
    const rows = await this.commentModel
      .aggregate<{ _id: Types.ObjectId; userId: Types.ObjectId; name: string; role: string; createdAt: Date }>([
        { $match: { threadId: { $in: threads.map((t) => new Types.ObjectId(t.id)) }, deletedAt: null } },
        { $sort: { createdAt: -1 } },
        {
          $group: {
            _id: '$threadId',
            userId: { $first: '$user.userId' },
            name: { $first: '$user.name' },
            role: { $first: '$user.role' },
            createdAt: { $first: '$createdAt' },
          },
        },
      ])
      .exec();
    const byThread = new Map<string, ForumLastReply>(
      rows.map((r) => [
        r._id.toString(),
        {
          userId: r.userId.toString(),
          name: r.name,
          role: r.role,
          createdAt: new Date(r.createdAt).toISOString(),
        },
      ]),
    );
    return threads.map((t) => ({ ...t, lastReply: byThread.get(t.id) ?? null }));
  }

  /**
   * TS-1305: replaces each author name (and Last post name) with the author's current forum display name —
   * the ULB name, "State DMA, <State>" or "MoHUA" — looked up live, so posts written before this rule (or
   * before a ULB was renamed) show the right name. Falls back to the stored name if the user no longer exists.
   */
  async withDisplayNames<T extends { user: ForumPublicUser; lastReply?: ForumLastReply | null }>(
    items: T[],
  ): Promise<T[]> {
    const names = await this.displayNames(
      items.flatMap((i) => (i.lastReply ? [i.user.userId, i.lastReply.userId] : [i.user.userId])),
    );
    const rename = <U extends { userId: string; name: string }>(u: U): U => ({
      ...u,
      name: names.get(u.userId) ?? u.name,
    });
    return items.map((i) => ({
      ...i,
      user: rename(i.user),
      ...(i.lastReply ? { lastReply: rename(i.lastReply) } : {}),
    }));
  }

  /**
   * Authors whose name, as the forum shows it, matches a search:
   * - `live`: existing users whose current display name matches (the ULB name, "State DMA, <State>",
   *   "MoHUA", or the account name / email for other roles).
   * - `orphaned`: authors whose user account no longer exists; for them only the name stored on the
   *   post is known, so the caller matches that instead.
   */
  private async authorsMatching(pattern: RegExp): Promise<{ live: Types.ObjectId[]; orphaned: Types.ObjectId[] }> {
    const [ulbIds, stateIds, storedNameAuthors] = await Promise.all([
      this.ulbModel.find({ name: pattern }).distinct('_id'),
      this.stateModel.find({ name: pattern }).distinct('_id'),
      this.threadModel.distinct('user.userId', { 'user.name': pattern, ...VISIBLE_THREAD }),
    ]);
    // Anyone who could carry a matching display name; each is then checked with the real rule.
    const candidates = await this.userModel
      .find({
        $or: [
          { role: { $in: FORUM_ULB_ROLES }, ulb: { $in: ulbIds } },
          { role: { $in: FORUM_STATE_ROLES }, state: { $in: stateIds } },
          ...(pattern.test(FORUM_MOHUA_NAME) ? [{ role: 'MoHUA' }] : []),
          { name: pattern },
          { email: pattern },
        ],
      })
      .distinct('_id');
    const names = await this.displayNames(candidates.map(String));
    const live = [...names].filter(([, name]) => pattern.test(name)).map(([id]) => new Types.ObjectId(id));
    const existing = new Set(
      (await this.userModel.find({ _id: { $in: storedNameAuthors } }).distinct('_id')).map(String),
    );
    const orphaned = storedNameAuthors.filter((id) => !existing.has(String(id)));
    return { live, orphaned };
  }

  /** userId → forum display name, in 3 queries (users, then their ULBs and States) whatever the count. */
  async displayNames(userIds: string[]): Promise<Map<string, string>> {
    const ids = [...new Set(userIds)].filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
    if (!ids.length) return new Map();
    const users = await this.userModel
      .find({ _id: { $in: ids } })
      .select('name email role ulb state')
      .lean()
      .exec();
    const refIds = (key: 'ulb' | 'state') => users.map((u) => u[key]).filter((id): id is Types.ObjectId => !!id);
    const [ulbs, states] = await Promise.all([
      this.ulbModel
        .find({ _id: { $in: refIds('ulb') } })
        .select('name')
        .lean()
        .exec(),
      this.stateModel
        .find({ _id: { $in: refIds('state') } })
        .select('name')
        .lean()
        .exec(),
    ]);
    const ulbName = new Map(ulbs.map((u) => [String(u._id), u.name]));
    const stateName = new Map(states.map((s) => [String(s._id), s.name]));
    return new Map(
      users.map((u) => [
        String(u._id),
        resolveForumDisplayName({
          role: u.role,
          accountName: u.name,
          email: u.email,
          ulbName: u.ulb ? ulbName.get(String(u.ulb)) : undefined,
          stateName: u.state ? stateName.get(String(u.state)) : undefined,
        }),
      ]),
    );
  }

  /** The user's forum display name (ULB / State DMA / MoHUA name, else the account name) and role. */
  private async userIdentity(userId: string): Promise<{ name: string; role?: string }> {
    const record = await this.userModel.findById(userId).select('name email role ulb state').lean().exec();
    const [ulb, state] = await Promise.all([
      record?.ulb ? this.ulbModel.findById(record.ulb).select('name').lean().exec() : null,
      record?.state ? this.stateModel.findById(record.state).select('name').lean().exec() : null,
    ]);
    return {
      name: resolveForumDisplayName({
        role: record?.role,
        accountName: record?.name,
        email: record?.email,
        ulbName: ulb?.name,
        stateName: state?.name,
      }),
      role: record?.role,
    };
  }

  private async embeddedUser(author: IAuthUser, meta: ForumRequestMetadata) {
    const { name } = await this.userIdentity(author._id);
    return {
      userId: new Types.ObjectId(author._id),
      name,
      role: author.role,
      ipAddress: meta.ipAddress,
      userAgentId: await this.findOrCreateUserAgent(meta.userAgent),
    };
  }

  private async findOrCreateUserAgent(value: string | null): Promise<Types.ObjectId | null> {
    if (!value) return null;
    const hash = createHash('sha256').update(value).digest('hex');
    const now = new Date();
    const doc = await this.userAgentModel
      .findOneAndUpdate(
        { hash },
        { $set: { lastSeenAt: now }, $setOnInsert: { value, createdAt: now } },
        { upsert: true, new: true },
      )
      .lean()
      .exec();
    return doc?._id ?? null;
  }
}
