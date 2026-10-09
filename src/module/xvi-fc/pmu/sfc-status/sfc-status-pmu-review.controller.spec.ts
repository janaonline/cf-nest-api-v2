import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { AccessLevel, Scope, UserRole } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { SfcStatusPmuReviewController } from './sfc-status-pmu-review.controller';
import { SfcStatusPmuReviewService } from './services/sfc-status-pmu-review.service';

describe('SfcStatusPmuReviewController', () => {
  const stateId = new Types.ObjectId().toString();
  const yearId = new Types.ObjectId().toString();
  const user: AuthUser = {
    _id: new Types.ObjectId().toString(),
    role: UserRole.ADMIN,
    scope: Scope.ADMIN,
    accessLevel: AccessLevel.ADMIN,
    state: null,
  };

  let controller: SfcStatusPmuReviewController;
  let reviewService: Record<string, jest.Mock>;

  beforeEach(async () => {
    reviewService = {
      getWorklist: jest.fn().mockResolvedValue({ success: true }),
      getReviewMetadata: jest.fn().mockResolvedValue({ success: true }),
      approveCompleteForm: jest.fn().mockResolvedValue({ success: true }),
      rejectCompleteForm: jest.fn().mockResolvedValue({ success: true }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SfcStatusPmuReviewController],
      providers: [{ provide: SfcStatusPmuReviewService, useValue: reviewService }],
    }).compile();

    controller = module.get(SfcStatusPmuReviewController);
  });

  it('GET worklist/:yearId delegates to SfcStatusPmuReviewService.getWorklist', async () => {
    const query = { page: 1, limit: 20 };
    await controller.getWorklist(yearId, query, user);
    expect(reviewService['getWorklist']).toHaveBeenCalledWith(yearId, query, user);
  });

  it('GET :stateId/:yearId delegates to SfcStatusPmuReviewService.getReviewMetadata', async () => {
    await controller.getReview(stateId, yearId, user);
    expect(reviewService['getReviewMetadata']).toHaveBeenCalledWith(stateId, yearId, user);
  });

  it('POST :stateId/:yearId/approve delegates to SfcStatusPmuReviewService.approveCompleteForm', async () => {
    await controller.approveForm(stateId, yearId, user, '127.0.0.1', 'jest-agent');
    expect(reviewService['approveCompleteForm']).toHaveBeenCalledWith(stateId, yearId, user, '127.0.0.1', 'jest-agent');
  });

  it('POST :stateId/:yearId/reject delegates to SfcStatusPmuReviewService.rejectCompleteForm', async () => {
    await controller.rejectForm(stateId, yearId, { pmuRemarks: 'Please redo.' }, user, '127.0.0.1', 'jest-agent');
    expect(reviewService['rejectCompleteForm']).toHaveBeenCalledWith(
      stateId,
      yearId,
      'Please redo.',
      user,
      '127.0.0.1',
      'jest-agent',
    );
  });
});
