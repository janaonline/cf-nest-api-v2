import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
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
  @ApiOperation({
    summary: 'Get form submission',
    description: 'Show one form submission with its current workflow status.',
  })
  getFormSubmissionDetails(
    @Param('formSubmissionId', ParseObjectIdPipe) id: string,
    @CurrentUser() user: IAuthUser,
  ): Promise<IFormSubmission> {
    return this.submissionsService.getFormSubmissionById(id, user);
  }

  @Get(':formSubmissionId/history')
  @ApiOperation({
    summary: 'Get status history',
    description: 'Show the full audit trail of status changes for a form submission.',
  })
  getFormStatusHistory(@Param('formSubmissionId') id: string): Promise<IFormStatusHistory[]> {
    return this.statusService.getFormStatusHistory(id);
  }

  @Post(':formSubmissionId/save-draft')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Save draft', description: 'Moves the form submission to in-progress state.' })
  saveDraft(
    @Param('formSubmissionId', ParseObjectIdPipe) id: string,
    @Body() dto: SaveDraftDto,
    @CurrentUser() user: IAuthUser,
  ): Promise<IFormSubmission> {
    return this.workflowService.saveDraft(id, user, dto);
  }

  @Post(':formSubmissionId/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit form', description: 'Submits the form to State for review.' })
  submitForm(
    @Param('formSubmissionId', ParseObjectIdPipe) id: string,
    @CurrentUser() user: IAuthUser,
  ): Promise<IFormSubmission> {
    return this.workflowService.submitForm(id, user);
  }

  @Post(':formSubmissionId/state/return')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Return by State', description: 'Returns the form to ULB with State remarks.' })
  returnFormByState(
    @Param('formSubmissionId', ParseObjectIdPipe) id: string,
    @Body() dto: ReturnFormDto,
    @CurrentUser() user: IAuthUser,
  ): Promise<IFormSubmission> {
    return this.workflowService.returnByState(id, user, dto);
  }

  @Post(':formSubmissionId/state/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve by State', description: 'Forwards the form from State review to MoHUA review.' })
  approveFormByState(
    @Param('formSubmissionId', ParseObjectIdPipe) id: string,
    @Body() dto: ApproveFormDto,
    @CurrentUser() user: IAuthUser,
  ): Promise<IFormSubmission> {
    return this.workflowService.approveByState(id, user, dto);
  }

  @Post(':formSubmissionId/mohua/return')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Return by MoHUA', description: 'Returns the form to ULB with MoHUA remarks.' })
  returnFormByMoHUA(
    @Param('formSubmissionId', ParseObjectIdPipe) id: string,
    @Body() dto: ReturnFormDto,
    @CurrentUser() user: IAuthUser,
  ): Promise<IFormSubmission> {
    return this.workflowService.returnByMoHUA(id, user, dto);
  }

  @Post(':formSubmissionId/mohua/acknowledge')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Acknowledge by MoHUA', description: 'Marks the form submission as acknowledged by MoHUA.' })
  acknowledgeFormByMoHUA(
    @Param('formSubmissionId', ParseObjectIdPipe) id: string,
    @Body() dto: AcknowledgeFormDto,
    @CurrentUser() user: IAuthUser,
  ): Promise<IFormSubmission> {
    return this.workflowService.acknowledgeByMoHUA(id, user, dto);
  }
}
