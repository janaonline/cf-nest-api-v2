import { createHash } from 'node:crypto';
import {
  BadRequestException,
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
import { User } from '../../schemas/user/user.schema';
import { Role } from '../auth/enum/role.enum';
import { CreateCommentDto, CreateThreadDto, UpdateThreadDto } from './dto/forum.dto';
import { FORUM_CATEGORIES, FORUM_CATEGORY_SLUGS, FORUM_THREAD_LIST_LIMIT } from './forum.constants';
import {
  ForumCategoryView,
  ForumCommentView,
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
  ) {}

  /** Idempotently seeds the canonical categories; existing rows keep their `_id` and `createdAt`. */
  async onModuleInit(): Promise<void> {
    const now = new Date();
    try {
      await Promise.all(
        FORUM_CATEGORIES.map((c) =>
          this.categoryModel.updateOne(
            { slug: c.slug },
            { $set: { name: c.name, description: c.description }, $setOnInsert: { createdAt: now } },
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
      const commentThreadIds = await this.commentModel.distinct('threadId', { body: pattern, deletedAt: null });
      filter.$or = [
        { title: pattern },
        { body: pattern },
        { categorySlug: pattern },
        { 'user.name': pattern },
        { _id: { $in: commentThreadIds } },
      ];
    }
    const threads = await this.threadModel
      .find(filter)
      .sort({ lastActivityAt: -1 })
      .limit(FORUM_THREAD_LIST_LIMIT)
      .lean()
      .exec();
    return this.withViewerFlags(
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
    return this.withViewerFlags(
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
    return this.withViewerFlags(sorted, user);
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
    const [viewCount, comments, likedThreadIds, bookmarkedThreadIds] = await Promise.all([
      this.recordUniqueView(threadId, new Types.ObjectId(user._id)),
      this.commentModel.find({ threadId, deletedAt: null }).sort({ createdAt: 1 }).lean().exec(),
      this.likedTargetIds(user._id, 'thread', [thread.id]),
      this.bookmarkedThreadIds(user._id, [thread.id]),
    ]);
    const serializedComments = comments.map((c) => serializeComment(c as never));
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
      },
      comments: serializedComments.map((c) => ({ ...c, liked: likedCommentIds.has(c.id) })),
    };
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
    return serializeThread(updated as never);
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

  // ----------------------------------------------------------------- comments

  async addComment(
    threadId: string,
    dto: CreateCommentDto,
    author: IAuthUser,
    meta: ForumRequestMetadata,
  ): Promise<ForumCommentView> {
    const id = this.toObjectId(threadId, 'Thread not found.');
    if (!(await this.threadModel.exists({ _id: id }))) throw new NotFoundException('Thread not found.');
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

  async softDeleteComment(id: Types.ObjectId, threadId: Types.ObjectId, deletedBy: string): Promise<void> {
    const ids = await this.commentTreeIds(id, { $eq: null });
    const result = await this.commentModel.updateMany(
      { _id: { $in: ids }, deletedAt: null },
      { $set: { deletedAt: new Date(), deletedBy: new Types.ObjectId(deletedBy), updatedAt: new Date() } },
    );
    if (result.modifiedCount) await this.adjustReplies(threadId, -result.modifiedCount);
  }

  async restoreComment(id: Types.ObjectId, threadId: Types.ObjectId): Promise<void> {
    const ids = await this.commentTreeIds(id, { $ne: null });
    const result = await this.commentModel.updateMany(
      { _id: { $in: ids }, deletedAt: { $ne: null } },
      { $set: { deletedAt: null, deletedBy: null, updatedAt: new Date() } },
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

  /** The comment plus its children and grandchildren whose `deletedAt` matches `deleted`. */
  private async commentTreeIds(id: Types.ObjectId, deleted: { $eq: null } | { $ne: null }): Promise<Types.ObjectId[]> {
    const children = await this.commentModel.find({ parentId: id, deletedAt: deleted }).distinct('_id');
    const grandchildren = children.length
      ? await this.commentModel.find({ parentId: { $in: children }, deletedAt: deleted }).distinct('_id')
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
    let delta = 0;
    if (active) {
      try {
        const result = await this.likeModel.updateOne(
          key,
          { $setOnInsert: { createdAt: new Date() } },
          { upsert: true },
        );
        delta = result.upsertedCount;
      } catch (error) {
        if (!isDuplicateKey(error)) throw error; // concurrent like by the same user: already counted
      }
    } else {
      delta = -(await this.likeModel.deleteOne(key)).deletedCount;
    }
    const updated = await model
      .findOneAndUpdate(
        targetFilter,
        [{ $set: { 'counts.likes': { $max: [0, { $add: [{ $ifNull: ['$counts.likes', 0] }, delta] }] } } }],
        { new: true, projection: { counts: 1 } },
      )
      .lean()
      .exec();
    if (!updated) throw new NotFoundException(targetType === 'thread' ? 'Thread not found.' : 'Comment not found.');
    return (updated as { counts?: { likes?: number } }).counts?.likes ?? 0;
  }

  private async setBookmark(userId: string, threadId: Types.ObjectId, active: boolean): Promise<number> {
    const key = { userId: new Types.ObjectId(userId), threadId };
    if (active) await this.bookmarkModel.updateOne(key, { $setOnInsert: { createdAt: new Date() } }, { upsert: true });
    else await this.bookmarkModel.deleteOne(key);
    const bookmarkCount = await this.bookmarkModel.countDocuments({ threadId });
    await this.threadModel.updateOne({ _id: threadId }, { $set: { 'counts.bookmarks': bookmarkCount } });
    return bookmarkCount;
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

  private async embeddedUser(author: IAuthUser, meta: ForumRequestMetadata) {
    const record = await this.userModel.findById(author._id).select('name email').lean().exec();
    const name = (record?.name?.trim() || record?.email || 'Unknown user').slice(0, 60);
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
