import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FORUM_DB_CONNECTION } from '../../core/database/forum-db.module';
import { ForumBookmark, ForumBookmarkSchema } from '../../schemas/forum/forum-bookmark.schema';
import { ForumCategory, ForumCategorySchema } from '../../schemas/forum/forum-category.schema';
import { ForumComment, ForumCommentSchema } from '../../schemas/forum/forum-comment.schema';
import { ForumLike, ForumLikeSchema } from '../../schemas/forum/forum-like.schema';
import { ForumThreadView, ForumThreadViewSchema } from '../../schemas/forum/forum-thread-view.schema';
import { ForumThread, ForumThreadSchema } from '../../schemas/forum/forum-thread.schema';
import { ForumUserAgent, ForumUserAgentSchema } from '../../schemas/forum/forum-user-agent.schema';
import { User, UserSchema } from '../../schemas/user/user.schema';
import { ForumAdminController } from './forum-admin.controller';
import { ForumAdminService } from './forum-admin.service';
import { ForumController } from './forum.controller';
import { ForumService } from './forum.service';

@Module({
  imports: [
    MongooseModule.forFeature(
      [
        { name: ForumThread.name, schema: ForumThreadSchema },
        { name: ForumComment.name, schema: ForumCommentSchema },
        { name: ForumCategory.name, schema: ForumCategorySchema },
        { name: ForumLike.name, schema: ForumLikeSchema },
        { name: ForumBookmark.name, schema: ForumBookmarkSchema },
        { name: ForumThreadView.name, schema: ForumThreadViewSchema },
        { name: ForumUserAgent.name, schema: ForumUserAgentSchema },
      ],
      FORUM_DB_CONNECTION,
    ),
    // Users live in the primary database, not forum_db.
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
  ],
  controllers: [ForumController, ForumAdminController],
  providers: [ForumService, ForumAdminService],
})
export class ForumModule {}
