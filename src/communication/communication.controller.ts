import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { CONTEXT_TYPE, THREAD_PURPOSE } from '../common/constants/communication.constants';
import type { IAuthUser } from '../common/interfaces/auth-user.interface';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { CurrentUser } from '../module/auth/decorators/current-user.decorator';
import { GetThreadsDto } from './dto/get-threads.dto';
import { SendFormMessageDto } from './dto/send-form-message.dto';
import { SendMessageDto } from './dto/send-message.dto';
import type { IMessageThread } from './interfaces/message-thread.interface';
import type { IMessage } from './interfaces/message.interface';
import { MessageThreadService } from './services/message-thread.service';
import { MessageService } from './services/message.service';

@Controller('communication')
export class CommunicationController {
  constructor(
    private readonly threadService: MessageThreadService,
    private readonly messageService: MessageService,
  ) {}

  // ─── Thread list / detail ────────────────────────────────────────────────────

  @Get('threads')
  @ApiOperation({
    summary: 'Get threads',
    description: 'Show all form conversations where current user has access.',
  })
  getThreads(
    @Query() query: GetThreadsDto,
    @CurrentUser() user: IAuthUser,
  ): Promise<{ threads: IMessageThread[]; total: number }> {
    return this.threadService.getThreads(user, {
      financialYear: query.financialYear,
      contextType: query.contextType,
      threadPurpose: query.threadPurpose,
      currentFormStatus: query.currentFormStatus,
      search: query.search,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    });
  }

  @Get('threads/:threadId')
  @ApiOperation({
    summary: 'Get thread details',
    description: 'Open one conversation and show its metadata.',
  })
  getThreadDetails(
    @Param('threadId', ParseObjectIdPipe) threadId: string,
    @CurrentUser() user: IAuthUser,
  ): Promise<IMessageThread> {
    return this.threadService.getThreadDetails(threadId, user);
  }

  @Get('threads/:threadId/messages')
  @ApiOperation({
    summary: 'Get thread messages',
    description: 'Open a conversation and load all messages - paginated.',
  })
  getThreadMessages(
    @Param('threadId', ParseObjectIdPipe) threadId: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @CurrentUser() user: IAuthUser,
  ): Promise<{ messages: IMessage[]; total: number; page: number; limit: number }> {
    return this.messageService.getThreadMessages({
      threadId,
      user,
      page: parseInt(page, 10),
      limit: Math.min(parseInt(limit, 10), 100),
    });
  }

  @Post('threads/:threadId/messages')
  @ApiOperation({
    summary: 'Send message to thread',
    description: 'Add a new message to an existing conversation.',
  })
  sendMessageToThread(
    @Param('threadId', ParseObjectIdPipe) threadId: string,
    @Body() dto: SendMessageDto,
    @CurrentUser() user: IAuthUser,
  ): Promise<IMessage> {
    return this.messageService.sendMessageToThread({
      threadId,
      senderUser: user,
      body: dto.body,
      attachments: dto.attachments,
      visibility: dto.visibility,
      parentMessageId: dto.parentMessageId,
    });
  }

  @Patch('threads/:threadId/read')
  @ApiOperation({
    summary: 'Mark thread as read',
    description: 'Marks the thread as read for the logged-in user. This resets the unread count to zero.',
  })
  @HttpCode(HttpStatus.OK)
  markThreadAsRead(
    @Param('threadId', ParseObjectIdPipe) threadId: string,
    @CurrentUser() user: IAuthUser,
  ): Promise<void> {
    return this.messageService.markThreadAsRead(threadId, user);
  }

  // ─── Form-submission scoped shortcuts ────────────────────────────────────────

  @Post(':formSubmissionId/messages')
  @ApiOperation({
    summary: 'Send message to form submission',
    description:
      'Send a message using the formSubmissionId (This is useful when the UI is on the Form Detail page and does not know the threadId).',
  })
  async sendMessageToFormSubmission(
    @Param('formSubmissionId', ParseObjectIdPipe) formSubmissionId: string,
    @Body() dto: SendFormMessageDto,
    @CurrentUser() user: IAuthUser,
  ): Promise<IMessage> {
    const thread = await this.resolveFormThread(formSubmissionId);
    return this.messageService.sendMessageToThread({
      threadId: thread._id.toString(),
      senderUser: user,
      body: dto.body,
      attachments: dto.attachments,
      visibility: dto.visibility,
      parentMessageId: dto.parentMessageId,
    });
  }

  @Get(':formSubmissionId/messages')
  @ApiOperation({
    summary: 'Get form submission messages',
    description:
      'Get all messages for a form submission using the formSubmissionId (This is useful when the UI is on the Form Detail page and does not know the threadId).',
  })
  async getFormSubmissionMessages(
    @Param('formSubmissionId', ParseObjectIdPipe) formSubmissionId: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @CurrentUser() user: IAuthUser,
  ): Promise<{ messages: IMessage[]; total: number; page: number; limit: number }> {
    const thread = await this.resolveFormThread(formSubmissionId);
    return this.messageService.getThreadMessages({
      threadId: thread._id.toString(),
      user,
      page: parseInt(page, 10),
      limit: Math.min(parseInt(limit, 10), 100),
    });
  }

  @Patch(':formSubmissionId/messages/read')
  @ApiOperation({
    summary: 'Mark form submission thread as read',
    description:
      'Marks the form submission thread as read for the logged-in user. This resets the unread count to zero.',
  })
  @HttpCode(HttpStatus.OK)
  async markFormSubmissionThreadAsRead(
    @Param('formSubmissionId', ParseObjectIdPipe) formSubmissionId: string,
    @CurrentUser() user: IAuthUser,
  ): Promise<void> {
    const thread = await this.resolveFormThread(formSubmissionId);
    return this.messageService.markThreadAsRead(thread._id.toString(), user);
  }

  private async resolveFormThread(formSubmissionId: string): Promise<IMessageThread> {
    const thread = await this.threadService.getThreadByContext(
      CONTEXT_TYPE.FORM_SUBMISSION,
      formSubmissionId,
      THREAD_PURPOSE.FORM_COMMUNICATION,
    );
    if (!thread) throw new NotFoundException('No thread found for this form submission');
    return thread;
  }
}
