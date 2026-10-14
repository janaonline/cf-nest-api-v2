import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { IAuthUser } from '../../common/interfaces/auth-user.interface';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enum/role.enum';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UseGuards } from '@nestjs/common';
import { CategoryDto, ModerateCommentDto, ModerateThreadDto } from './dto/forum.dto';
import { ForumAdminService } from './forum-admin.service';

@ApiTags('Forum admin')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles([Role.ADMIN])
@Controller('forum/admin')
export class ForumAdminController {
  constructor(private readonly admin: ForumAdminService) {}

  @Get('threads')
  @ApiOperation({ summary: 'All threads, including unpublished and deleted' })
  threads() {
    return this.admin.listThreads();
  }

  @Patch('threads/:threadId')
  @ApiOperation({ summary: 'Publish / unpublish or soft-delete / restore a thread' })
  moderateThread(
    @Param('threadId', ParseObjectIdPipe) threadId: string,
    @Body() dto: ModerateThreadDto,
    @CurrentUser() admin: IAuthUser,
  ) {
    return this.admin.moderateThread(threadId, dto, admin);
  }

  @Get('comments')
  @ApiOperation({ summary: 'All comments, including deleted' })
  comments() {
    return this.admin.listComments();
  }

  @Patch('comments/:commentId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete / restore a comment' })
  async moderateComment(
    @Param('commentId', ParseObjectIdPipe) commentId: string,
    @Body() dto: ModerateCommentDto,
    @CurrentUser() admin: IAuthUser,
  ) {
    await this.admin.moderateComment(commentId, dto, admin);
    return { updated: true };
  }

  @Post('categories')
  @ApiOperation({ summary: 'Create a category' })
  createCategory(@Body() dto: CategoryDto) {
    return this.admin.createCategory(dto);
  }

  @Patch('categories/:categoryId')
  @ApiOperation({ summary: 'Update a category (threads follow the new slug)' })
  updateCategory(@Param('categoryId', ParseObjectIdPipe) categoryId: string, @Body() dto: CategoryDto) {
    return this.admin.updateCategory(categoryId, dto);
  }

  @Delete('categories/:categoryId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete an empty category' })
  async deleteCategory(@Param('categoryId', ParseObjectIdPipe) categoryId: string) {
    await this.admin.deleteCategory(categoryId);
    return { deleted: true };
  }
}
