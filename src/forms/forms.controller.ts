import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import type { IAuthUser } from '../common/interfaces/auth-user.interface';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { CurrentUser } from '../module/auth/decorators/current-user.decorator';
import { AcknowledgeFormDto } from './dto/acknowledge-form.dto';
import { ApproveFormDto } from './dto/approve-form.dto';
import { ReturnFormDto } from './dto/return-form.dto';
import { SaveDraftDto } from './dto/save-draft.dto';
import type { IFormStatusHistory } from './interfaces/form-status-history.interface';
import type { IFormSubmission } from './interfaces/form-submission.interface';
import { FormSubmissionStatusService } from './services/form-submission-status.service';
import { FormSubmissionsService } from './services/form-submissions.service';
import { FormWorkflowService } from './services/form-workflow.service';

@Controller('forms')
export class FormsController {
  constructor(
    private readonly workflowService: FormWorkflowService,
    private readonly submissionsService: FormSubmissionsService,
    private readonly statusService: FormSubmissionStatusService,
  ) {}

  @Get(':formSubmissionId')
  getFormSubmissionDetails(
    @Param('formSubmissionId', ParseObjectIdPipe) id: string,
    @CurrentUser() user: IAuthUser,
  ): Promise<IFormSubmission> {
    return this.submissionsService.getFormSubmissionById(id, user);
  }

  @Get(':formSubmissionId/history')
  getFormStatusHistory(@Param('formSubmissionId') id: string): Promise<IFormStatusHistory[]> {
    return this.statusService.getFormStatusHistory(id);
  }

  @Post(':formSubmissionId/save-draft')
  @HttpCode(HttpStatus.OK)
  saveDraft(
    @Param('formSubmissionId', ParseObjectIdPipe) id: string,
    @Body() dto: SaveDraftDto,
    @CurrentUser() user: IAuthUser,
  ): Promise<IFormSubmission> {
    return this.workflowService.saveDraft(id, user, dto);
  }

  @Post(':formSubmissionId/submit')
  @HttpCode(HttpStatus.OK)
  submitForm(
    @Param('formSubmissionId', ParseObjectIdPipe) id: string,
    @CurrentUser() user: IAuthUser,
  ): Promise<IFormSubmission> {
    return this.workflowService.submitForm(id, user);
  }

  @Post(':formSubmissionId/state/return')
  @HttpCode(HttpStatus.OK)
  returnFormByState(
    @Param('formSubmissionId', ParseObjectIdPipe) id: string,
    @Body() dto: ReturnFormDto,
    @CurrentUser() user: IAuthUser,
  ): Promise<IFormSubmission> {
    return this.workflowService.returnByState(id, user, dto);
  }

  @Post(':formSubmissionId/state/approve')
  @HttpCode(HttpStatus.OK)
  approveFormByState(
    @Param('formSubmissionId', ParseObjectIdPipe) id: string,
    @Body() dto: ApproveFormDto,
    @CurrentUser() user: IAuthUser,
  ): Promise<IFormSubmission> {
    return this.workflowService.approveByState(id, user, dto);
  }

  @Post(':formSubmissionId/mohua/return')
  @HttpCode(HttpStatus.OK)
  returnFormByMoHUA(
    @Param('formSubmissionId', ParseObjectIdPipe) id: string,
    @Body() dto: ReturnFormDto,
    @CurrentUser() user: IAuthUser,
  ): Promise<IFormSubmission> {
    return this.workflowService.returnByMoHUA(id, user, dto);
  }

  @Post(':formSubmissionId/mohua/acknowledge')
  @HttpCode(HttpStatus.OK)
  acknowledgeFormByMoHUA(
    @Param('formSubmissionId', ParseObjectIdPipe) id: string,
    @Body() dto: AcknowledgeFormDto,
    @CurrentUser() user: IAuthUser,
  ): Promise<IFormSubmission> {
    return this.workflowService.acknowledgeByMoHUA(id, user, dto);
  }
}
