import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { IAuthUser } from '../../common/interfaces/auth-user.interface';
import { CategoryDto, ModerateCommentDto, ModerateThreadDto } from './dto/forum.dto';
import { FORUM_ADMIN_LIST_LIMIT } from './forum.constants';
import { ForumService } from './forum.service';
import {
  ForumAdminCommentView,
  ForumAdminReportView,
  ForumCategoryView,
  ForumThreadView,
  serializeCategory,
  serializeComment,
  serializeThread,
} from './forum.types';
import { slugify } from './forum.util';

const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;

const EXCERPT_LENGTH = 160;

/** Plain-text start of a markdown / HTML body for the reports list. */
export function excerpt(body: string | undefined): string {
  const text = (body ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[#*_`>~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > EXCERPT_LENGTH ? `${text.slice(0, EXCERPT_LENGTH - 1)}…` : text;
}

/** ADMIN-only moderation and category management. Role gating happens at the controller. */
@Injectable()
export class ForumAdminService {
  constructor(private readonly forum: ForumService) {}

  async listThreads(): Promise<ForumThreadView[]> {
    const threads = await this.forum.threadModel
      .find()
      .sort({ updatedAt: -1 })
      .limit(FORUM_ADMIN_LIST_LIMIT)
      .lean()
      .exec();
    return this.forum.withDisplayNames(threads.map((t) => serializeThread(t as never)));
  }

  async moderateThread(threadId: string, dto: ModerateThreadDto, admin: IAuthUser): Promise<ForumThreadView> {
    const id = this.forum.toObjectId(threadId, 'Thread not found.');
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof dto.isPublished === 'boolean') set['isPublished'] = dto.isPublished;
    if (typeof dto.isDeleted === 'boolean') {
      set['deletedAt'] = dto.isDeleted ? new Date() : null;
      set['deletedBy'] = dto.isDeleted ? new Types.ObjectId(admin._id) : null;
      if (dto.isDeleted) set['isPublished'] = false;
    }
    const thread = await this.forum.threadModel.findByIdAndUpdate(id, { $set: set }, { new: true }).lean().exec();
    if (!thread) throw new NotFoundException('Thread not found.');
    const [view] = await this.forum.withDisplayNames([serializeThread(thread as never)]);
    return view;
  }

  async listComments(): Promise<ForumAdminCommentView[]> {
    const comments = await this.forum.commentModel
      .find()
      .sort({ updatedAt: -1 })
      .limit(FORUM_ADMIN_LIST_LIMIT)
      .lean()
      .exec();
    const threadIds = [...new Set(comments.map((c) => c.threadId.toString()))].map((id) => new Types.ObjectId(id));
    const threads = await this.forum.threadModel
      .find({ _id: { $in: threadIds } })
      .select('title slug')
      .lean()
      .exec();
    const byId = new Map(threads.map((t) => [t._id.toString(), t]));
    return this.forum.withDisplayNames(
      comments.map((c) => {
        const thread = byId.get(c.threadId.toString());
        return {
          ...serializeComment(c as never),
          threadTitle: thread?.title ?? 'Deleted thread',
          threadSlug: thread?.slug ?? null,
        };
      }),
    );
  }

  async moderateComment(commentId: string, dto: ModerateCommentDto, admin: IAuthUser): Promise<void> {
    const id = this.forum.toObjectId(commentId, 'Comment not found.');
    const comment = await this.forum.commentModel.findById(id).lean().exec();
    if (!comment || dto.isDeleted === !!comment.deletedAt) {
      // Deleting an already-deleted comment (or restoring a live one) is a no-op the UI should not offer.
      throw new NotFoundException(dto.isDeleted ? 'Comment not found.' : 'Deleted comment not found.');
    }
    if (dto.isDeleted) await this.forum.softDeleteComment(comment._id, comment.threadId, admin._id);
    else await this.forum.restoreComment(comment._id, comment.threadId);
  }

  // ------------------------------------------------------------------ reports

  /** Open reports, newest first, each with the reported post's context for the ADMIN reports list. */
  async listReports(): Promise<ForumAdminReportView[]> {
    const reports = await this.forum.reportModel
      .find({ status: 'open' })
      .sort({ createdAt: -1 })
      .limit(FORUM_ADMIN_LIST_LIMIT)
      .lean()
      .exec();
    if (!reports.length) return [];
    const commentIds = reports.filter((r) => r.targetType === 'comment').map((r) => r.targetId);
    const [threads, comments] = await Promise.all([
      this.forum.threadModel
        .find({ _id: { $in: reports.map((r) => r.threadId) } })
        .select('title slug body user isPublished deletedAt')
        .lean()
        .exec(),
      this.forum.commentModel
        .find({ _id: { $in: commentIds } })
        .select('body user deletedAt')
        .lean()
        .exec(),
    ]);
    const threadById = new Map(threads.map((t) => [t._id.toString(), t]));
    const commentById = new Map(comments.map((c) => [c._id.toString(), c]));
    const posts = reports.map((r) =>
      r.targetType === 'thread' ? threadById.get(r.threadId.toString()) : commentById.get(r.targetId.toString()),
    );
    const names = await this.forum.displayNames([
      ...reports.map((r) => r.reporter.userId.toString()),
      ...posts.flatMap((p) => (p ? [p.user.userId.toString()] : [])),
    ]);
    const nameOf = (userId: string, stored: string) => names.get(userId) ?? stored;
    return reports.map((r, index) => {
      const thread = threadById.get(r.threadId.toString());
      const threadHidden = !thread || thread.isPublished === false || !!thread.deletedAt;
      const post = posts[index];
      const authorId = post?.user.userId.toString();
      const reporterId = r.reporter.userId.toString();
      return {
        id: r._id.toString(),
        targetType: r.targetType,
        targetId: r.targetId.toString(),
        threadId: r.threadId.toString(),
        threadTitle: thread?.title ?? 'Deleted thread',
        threadSlug: thread?.slug ?? null,
        excerpt: excerpt(post?.body),
        author:
          post && authorId ? { userId: authorId, name: nameOf(authorId, post.user.name), role: post.user.role } : null,
        reason: r.reason,
        reporter: { userId: reporterId, name: nameOf(reporterId, r.reporter.name), role: r.reporter.role },
        createdAt: r.createdAt.toISOString(),
        // A reply in an unpublished / deleted thread is hidden too: nobody can reach it there.
        isHidden: r.targetType === 'thread' ? threadHidden : threadHidden || !post || !!post.deletedAt,
      };
    });
  }

  /**
   * `hide` hides the reported post with the existing moderation (a thread is unpublished, a reply is
   * soft-deleted — both restorable from the Threads admin page) and resolves every open report on it.
   * `dismiss` keeps the post and resolves only this report.
   */
  async resolveReport(reportId: string, action: 'hide' | 'dismiss', admin: IAuthUser): Promise<{ updated: true }> {
    const id = this.forum.toObjectId(reportId, 'Report not found.');
    const report = await this.forum.reportModel.findOne({ _id: id, status: 'open' }).lean().exec();
    if (!report) throw new NotFoundException('Report not found or already resolved.');
    const resolved = { resolvedAt: new Date(), resolvedBy: new Types.ObjectId(admin._id) };
    if (action === 'dismiss') {
      await this.forum.reportModel.updateOne({ _id: id }, { $set: { status: 'dismissed', ...resolved } });
      return { updated: true };
    }
    if (report.targetType === 'thread') {
      await this.moderateThread(report.targetId.toString(), { isPublished: false }, admin);
    } else {
      const comment = await this.forum.commentModel.findById(report.targetId).select('deletedAt').lean().exec();
      // A reply that is already hidden needs no moderation; its open reports are still resolved below.
      if (comment && !comment.deletedAt)
        await this.moderateComment(report.targetId.toString(), { isDeleted: true }, admin);
    }
    await this.forum.reportModel.updateMany(
      { targetType: report.targetType, targetId: report.targetId, status: 'open' },
      { $set: { status: 'hidden', ...resolved } },
    );
    return { updated: true };
  }

  async createCategory(dto: CategoryDto): Promise<ForumCategoryView> {
    const input = this.normalize(dto);
    try {
      const created = await this.forum.categoryModel.create({ ...input, createdAt: new Date() });
      return serializeCategory(created.toObject() as never);
    } catch (error) {
      if (isDuplicateKey(error)) throw new ConflictException('That category slug is already in use.');
      throw error;
    }
  }

  async updateCategory(categoryId: string, dto: CategoryDto): Promise<ForumCategoryView> {
    const id = this.forum.toObjectId(categoryId, 'Category not found.');
    const input = this.normalize(dto);
    try {
      const category = await this.forum.categoryModel
        .findByIdAndUpdate(id, { $set: input }, { new: true, runValidators: true })
        .lean()
        .exec();
      if (!category) throw new NotFoundException('Category not found.');
      await this.forum.threadModel.updateMany(
        { categoryId: id },
        { $set: { categorySlug: category.slug, updatedAt: new Date() } },
      );
      return serializeCategory(category as never);
    } catch (error) {
      if (isDuplicateKey(error)) throw new ConflictException('That category slug is already in use.');
      throw error;
    }
  }

  async deleteCategory(categoryId: string): Promise<void> {
    const id = this.forum.toObjectId(categoryId, 'Category not found.');
    if (await this.forum.threadModel.countDocuments({ categoryId: id })) {
      throw new ConflictException("Move or delete this category's threads before deleting it.");
    }
    if (!(await this.forum.categoryModel.deleteOne({ _id: id })).deletedCount) {
      throw new NotFoundException('Category not found.');
    }
  }

  private normalize(dto: CategoryDto) {
    const slug = slugify(dto.slug || dto.name);
    if (slug.length > 60) throw new ConflictException('Slug must be 60 characters or fewer.');
    return { name: dto.name, slug, description: dto.description };
  }
}
