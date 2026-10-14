import { Types } from 'mongoose';
import { ForumCategory } from '../../schemas/forum/forum-category.schema';
import { ForumComment } from '../../schemas/forum/forum-comment.schema';
import { ForumThread } from '../../schemas/forum/forum-thread.schema';

export interface ForumPublicUser {
  userId: string;
  name: string;
  role: string;
}

export interface ForumCategoryView {
  id: string;
  name: string;
  slug: string;
  description: string;
  createdAt: string;
}

export interface ForumThreadView {
  id: string;
  title: string;
  slug: string;
  body: string;
  categoryId: string;
  categorySlug: string;
  user: ForumPublicUser;
  replyCount: number;
  viewCount: number;
  likeCount: number;
  bookmarkCount: number;
  isPublished: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  /** Viewer-specific flags, present on every endpoint that returns threads to the signed-in user. */
  liked?: boolean;
  bookmarked?: boolean;
}

export interface ForumCommentView {
  id: string;
  threadId: string;
  parentId?: string;
  body: string;
  user: ForumPublicUser;
  likeCount: number;
  deletedAt: string | null;
  deletedBy: string | null;
  createdAt: string;
  updatedAt: string;
  liked?: boolean;
}

export interface ForumAdminCommentView extends ForumCommentView {
  threadTitle: string;
  threadSlug: string | null;
}

export interface ForumRequestMetadata {
  ipAddress: string | null;
  userAgent: string | null;
}

type WithId<T> = T & { _id: Types.ObjectId };

export function serializeCategory(category: WithId<ForumCategory>): ForumCategoryView {
  return {
    id: category._id.toString(),
    name: category.name,
    slug: category.slug,
    description: category.description,
    createdAt: category.createdAt.toISOString(),
  };
}

export function serializeThread(thread: WithId<ForumThread>): ForumThreadView {
  return {
    id: thread._id.toString(),
    title: thread.title,
    slug: thread.slug,
    body: thread.body,
    categoryId: thread.categoryId.toString(),
    categorySlug: thread.categorySlug,
    user: { userId: thread.user.userId.toString(), name: thread.user.name, role: thread.user.role },
    replyCount: thread.counts?.replies ?? 0,
    viewCount: thread.counts?.views ?? 0,
    likeCount: thread.counts?.likes ?? 0,
    bookmarkCount: thread.counts?.bookmarks ?? 0,
    isPublished: thread.isPublished !== false,
    deletedAt: thread.deletedAt?.toISOString() ?? null,
    createdAt: thread.createdAt.toISOString(),
    updatedAt: thread.updatedAt.toISOString(),
    lastActivityAt: thread.lastActivityAt.toISOString(),
  };
}

export function serializeComment(comment: WithId<ForumComment>): ForumCommentView {
  return {
    id: comment._id.toString(),
    threadId: comment.threadId.toString(),
    parentId: comment.parentId?.toString(),
    body: comment.body,
    user: { userId: comment.user.userId.toString(), name: comment.user.name, role: comment.user.role },
    likeCount: comment.counts?.likes ?? 0,
    deletedAt: comment.deletedAt?.toISOString() ?? null,
    deletedBy: comment.deletedBy?.toString() ?? null,
    createdAt: comment.createdAt.toISOString(),
    updatedAt: comment.updatedAt.toISOString(),
  };
}
