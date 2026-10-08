import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { AccessLevel, Scope, UserRole } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { BadRequestException } from '@nestjs/common';
import { DevolutionFormulaPmuReviewController } from './devolution-formula-pmu-review.controller';
import { DevolutionFormulaPmuReviewService } from './services/devolution-formula-pmu-review.service';

describe('DevolutionFormulaPmuReviewController', () => {
  const stateId = new Types.ObjectId().toString();
  const yearId = new Types.ObjectId().toString();
  const user: AuthUser = {
    _id: new Types.ObjectId().toString(),
    role: UserRole.ADMIN,
    scope: Scope.ADMIN,
    accessLevel: AccessLevel.ADMIN,
    state: null,
  };

  let controller: DevolutionFormulaPmuReviewController;
  let reviewService: Record<string, jest.Mock>;

  beforeEach(async () => {
    reviewService = {
      getWorklist: jest.fn().mockResolvedValue({ success: true }),
      getReviewMetadata: jest.fn().mockResolvedValue({ success: true }),
      getRows: jest.fn().mockResolvedValue({ success: true }),
      approveCompleteForm: jest.fn().mockResolvedValue({ success: true }),
      rejectCompleteForm: jest.fn().mockResolvedValue({ success: true }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DevolutionFormulaPmuReviewController],
      providers: [{ provide: DevolutionFormulaPmuReviewService, useValue: reviewService }],
    }).compile();

    controller = module.get(DevolutionFormulaPmuReviewController);
  });

  it('GET worklist/:yearId delegates to DevolutionFormulaPmuReviewService.getWorklist', async () => {
    await controller.getWorklist(yearId, user);
    expect(reviewService['getWorklist']).toHaveBeenCalledWith(yearId, user);
  });

  it('GET :stateId/:yearId/:installment delegates with the parsed installment', async () => {
    await controller.getReview(stateId, yearId, '2', user);
    expect(reviewService['getReviewMetadata']).toHaveBeenCalledWith(stateId, yearId, 2, user);
  });

  it('rejects an invalid installment', async () => {
    expect(() => controller.getReview(stateId, yearId, '3', user)).toThrow(BadRequestException);
  });

  it('GET :stateId/:yearId/:installment/rows delegates with the parsed installment', async () => {
    await controller.getRows(stateId, yearId, '2', user);
    expect(reviewService['getRows']).toHaveBeenCalledWith(stateId, yearId, 2, user);
  });

  it('POST :stateId/:yearId/:installment/approve delegates with the parsed installment', async () => {
    await controller.approveForm(stateId, yearId, '1', user, '127.0.0.1', 'jest-agent');
    expect(reviewService['approveCompleteForm']).toHaveBeenCalledWith(
      stateId,
      yearId,
      1,
      user,
      '127.0.0.1',
      'jest-agent',
    );
  });

  it('POST :stateId/:yearId/:installment/reject delegates with the parsed installment', async () => {
    await controller.rejectForm(stateId, yearId, '1', { pmuRemarks: 'Please redo.' }, user, '127.0.0.1', 'jest-agent');
    expect(reviewService['rejectCompleteForm']).toHaveBeenCalledWith(
      stateId,
      yearId,
      1,
      'Please redo.',
      user,
      '127.0.0.1',
      'jest-agent',
    );
  });
});
