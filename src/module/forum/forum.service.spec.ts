import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { IAuthUser } from '../../common/interfaces/auth-user.interface';
import { Role } from '../auth/enum/role.enum';
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
  const service = new ForumService(...(Array(8).fill(undefined) as ConstructorParameters<typeof ForumService>));
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
