import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { IAuthUser } from '../../common/interfaces/auth-user.interface';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  CommentLikeDto,
  CreateCommentDto,
  CreateThreadDto,
  ListThreadsQueryDto,
  ThreadReactionDto,
  UpdateThreadDto,
} from './dto/forum.dto';
import { ForumService } from './forum.service';
import { ForumRequestMetadata } from './forum.types';
import { boundedHeader } from './forum.util';

/** Any authenticated user may use the forum; the global JwtAuthGuard enforces the sign-in. */
@ApiTags('Forum')
@ApiBearerAuth()
@Controller('forum')
export class ForumController {
  constructor(private readonly forum: ForumService) {}

  @Get('categories')
  @ApiOperation({ summary: 'List forum categories' })
  categories() {
    return this.forum.listCategories();
  }

  @Get('threads')
  @ApiOperation({ summary: 'List visible threads, optionally filtered by category or search text' })
  threads(@Query() query: ListThreadsQueryDto, @CurrentUser() user: IAuthUser) {
    return this.forum.listThreads(user, query.category || undefined, query.q);
  }

  // Declared before `threads/:slug` so "mine" / "saved" are not captured as slugs.
  @Get('threads/mine')
  @ApiOperation({ summary: "List the signed-in user's own threads" })
  myThreads(@CurrentUser() user: IAuthUser) {
    return this.forum.listMyThreads(user);
  }

  @Get('threads/saved')
  @ApiOperation({ summary: "List the signed-in user's bookmarked threads" })
  savedThreads(@CurrentUser() user: IAuthUser) {
    return this.forum.listSavedThreads(user);
  }

  @Get('threads/:slug')
  @ApiOperation({ summary: 'Thread detail with its comments; counts one view per user' })
  thread(@Param('slug') slug: string, @CurrentUser() user: IAuthUser) {
    return this.forum.getThreadDetail(slug, user);
  }

  @Post('threads')
  @ApiOperation({ summary: 'Start a discussion' })
  createThread(@Body() dto: CreateThreadDto, @CurrentUser() user: IAuthUser, @Req() req: Request) {
    return this.forum.createThread(dto, user, this.metadata(req));
  }

  @Patch('threads/:threadId')
  @ApiOperation({ summary: 'Edit a thread (author or ADMIN)' })
  editThread(
    @Param('threadId', ParseObjectIdPipe) threadId: string,
    @Body() dto: UpdateThreadDto,
    @CurrentUser() user: IAuthUser,
  ) {
    return this.forum.editThread(threadId, dto, user);
  }

  @Delete('threads/:threadId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete a thread (author or ADMIN)' })
  async deleteThread(@Param('threadId', ParseObjectIdPipe) threadId: string, @CurrentUser() user: IAuthUser) {
    await this.forum.deleteThread(threadId, user);
    return { deleted: true };
  }

  @Post('threads/:threadId/comments')
  @ApiOperation({ summary: 'Reply to a thread, or to a comment via parentId' })
  addComment(
    @Param('threadId', ParseObjectIdPipe) threadId: string,
    @Body() dto: CreateCommentDto,
    @CurrentUser() user: IAuthUser,
    @Req() req: Request,
  ) {
    return this.forum.addComment(threadId, dto, user, this.metadata(req));
  }

  @Post('threads/:threadId/reactions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Like / unlike or bookmark / unbookmark a thread' })
  react(
    @Param('threadId', ParseObjectIdPipe) threadId: string,
    @Body() dto: ThreadReactionDto,
    @CurrentUser() user: IAuthUser,
  ) {
    return this.forum.reactToThread(threadId, dto.reaction, dto.active, user);
  }

  @Delete('comments/:commentId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete a comment and its replies (author or ADMIN)' })
  async deleteComment(@Param('commentId', ParseObjectIdPipe) commentId: string, @CurrentUser() user: IAuthUser) {
    await this.forum.deleteComment(commentId, user);
    return { deleted: true };
  }

  @Post('comments/:commentId/like')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Like / unlike a comment' })
  likeComment(
    @Param('commentId', ParseObjectIdPipe) commentId: string,
    @Body() dto: CommentLikeDto,
    @CurrentUser() user: IAuthUser,
  ) {
    return this.forum.likeComment(commentId, dto.active, user);
  }

  /** `req.ip` honours `trust proxy` (main.ts); the forwarded headers are never read directly. */
  private metadata(req: Request): ForumRequestMetadata {
    return { ipAddress: boundedHeader(req.ip, 64), userAgent: boundedHeader(req.headers['user-agent'], 512) };
  }
}
