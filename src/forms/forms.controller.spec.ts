import { Test, TestingModule } from '@nestjs/testing';
import type { IAuthUser } from '../common/interfaces/auth-user.interface';
import { Role } from '../module/auth/enum/role.enum';
import { FormsController } from './forms.controller';
import { FormSubmissionStatusService } from './services/form-submission-status.service';
import { FormSubmissionsService } from './services/form-submissions.service';
import { FormWorkflowService } from './services/form-workflow.service';

describe('FormsController', () => {
  let controller: FormsController;
  let workflowService: {
    saveDraft: jest.Mock;
    submitForm: jest.Mock;
    returnByState: jest.Mock;
    approveByState: jest.Mock;
    returnByMoHUA: jest.Mock;
    acknowledgeByMoHUA: jest.Mock;
  };
  let submissionsService: { getFormSubmissionById: jest.Mock };
  let statusService: { getFormStatusHistory: jest.Mock };

  const ulbUser: IAuthUser = { _id: '507f1f77bcf86cd799439011', role: Role.ULB };

  beforeEach(async () => {
    workflowService = {
      saveDraft: jest.fn(),
      submitForm: jest.fn(),
      returnByState: jest.fn(),
      approveByState: jest.fn(),
      returnByMoHUA: jest.fn(),
      acknowledgeByMoHUA: jest.fn(),
    };
    submissionsService = { getFormSubmissionById: jest.fn() };
    statusService = { getFormStatusHistory: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FormsController],
      providers: [
        { provide: FormWorkflowService, useValue: workflowService },
        { provide: FormSubmissionsService, useValue: submissionsService },
        { provide: FormSubmissionStatusService, useValue: statusService },
      ],
    }).compile();

    controller = module.get<FormsController>(FormsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates getFormSubmissionDetails to submissionsService with id and user', () => {
    void controller.getFormSubmissionDetails('sub1', ulbUser);
    expect(submissionsService.getFormSubmissionById).toHaveBeenCalledWith('sub1', ulbUser);
  });

  it('delegates getFormStatusHistory to statusService with id', () => {
    void controller.getFormStatusHistory('sub1');
    expect(statusService.getFormStatusHistory).toHaveBeenCalledWith('sub1');
  });

  it('delegates saveDraft to workflowService with id, user, dto', () => {
    const dto = {};
    void controller.saveDraft('sub1', dto, ulbUser);
    expect(workflowService.saveDraft).toHaveBeenCalledWith('sub1', ulbUser, dto);
  });

  it('delegates submitForm to workflowService with id and user', () => {
    void controller.submitForm('sub1', ulbUser);
    expect(workflowService.submitForm).toHaveBeenCalledWith('sub1', ulbUser);
  });

  it('delegates returnFormByState to workflowService with id, user, dto', () => {
    const dto = { remarks: 'fix this' };
    void controller.returnFormByState('sub1', dto, ulbUser);
    expect(workflowService.returnByState).toHaveBeenCalledWith('sub1', ulbUser, dto);
  });

  it('delegates approveFormByState to workflowService with id, user, dto', () => {
    const dto = { remarks: 'looks good' };
    void controller.approveFormByState('sub1', dto, ulbUser);
    expect(workflowService.approveByState).toHaveBeenCalledWith('sub1', ulbUser, dto);
  });

  it('delegates returnFormByMoHUA to workflowService with id, user, dto', () => {
    const dto = { remarks: 'needs rework' };
    void controller.returnFormByMoHUA('sub1', dto, ulbUser);
    expect(workflowService.returnByMoHUA).toHaveBeenCalledWith('sub1', ulbUser, dto);
  });

  it('delegates acknowledgeFormByMoHUA to workflowService with id, user, dto', () => {
    const dto = { remarks: 'acknowledged' };
    void controller.acknowledgeFormByMoHUA('sub1', dto, ulbUser);
    expect(workflowService.acknowledgeByMoHUA).toHaveBeenCalledWith('sub1', ulbUser, dto);
  });
});
