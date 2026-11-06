import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { IAuthUser } from '../../common/interfaces/auth-user.interface';
import { CategoryDto, ModerateCommentDto, ModerateThreadDto } from './dto/forum.dto';
import { FORUM_ADMIN_LIST_LIMIT } from './forum.constants';
import { ForumService } from './forum.service';
import {
  ForumAdminCommentView,
  ForumCategoryView,
  ForumThreadView,
  serializeCategory,
  serializeComment,
  serializeThread,
} from './forum.types';
import { slugify } from './forum.util';

const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;

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
    return threads.map((t) => serializeThread(t as never));
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
    return serializeThread(thread as never);
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
    return comments.map((c) => {
      const thread = byId.get(c.threadId.toString());
      return {
        ...serializeComment(c as never),
        threadTitle: thread?.title ?? 'Deleted thread',
        threadSlug: thread?.slug ?? null,
      };
    });
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
