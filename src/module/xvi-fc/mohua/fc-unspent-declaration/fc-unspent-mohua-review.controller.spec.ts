import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { AccessLevel, Scope, UserRole } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { FcUnspentMohuaReviewController } from './fc-unspent-mohua-review.controller';
import { FcUnspentMohuaReviewService } from './services/fc-unspent-mohua-review.service';
import { FcUnspentMohuaRowsService } from './services/fc-unspent-mohua-rows.service';
import type { BulkApproveFcUnspentRowsDto } from './dto/bulk-approve-fc-unspent-rows.dto';
import type { BulkRejectFcUnspentRowsDto } from './dto/bulk-reject-fc-unspent-rows.dto';

describe('FcUnspentMohuaReviewController', () => {
  const stateId = new Types.ObjectId().toString();
  const yearId = new Types.ObjectId().toString();
  const user: AuthUser = {
    _id: new Types.ObjectId().toString(),
    role: UserRole.ADMIN,
    scope: Scope.ADMIN,
    accessLevel: AccessLevel.ADMIN,
    state: null,
  };

  let controller: FcUnspentMohuaReviewController;
  let reviewService: Record<string, jest.Mock>;
  let rowsService: Record<string, jest.Mock>;

  beforeEach(async () => {
    reviewService = {
      getReviewMetadata: jest.fn().mockResolvedValue({ success: true }),
      approveCompleteForm: jest.fn().mockResolvedValue({ success: true }),
      rejectCompleteForm: jest.fn().mockResolvedValue({ success: true }),
    };
    rowsService = {
      getRows: jest.fn().mockResolvedValue({ success: true }),
      bulkApproveRows: jest.fn().mockResolvedValue({ success: true }),
      bulkRejectRows: jest.fn().mockResolvedValue({ success: true }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FcUnspentMohuaReviewController],
      providers: [
        { provide: FcUnspentMohuaReviewService, useValue: reviewService },
        { provide: FcUnspentMohuaRowsService, useValue: rowsService },
      ],
    }).compile();

    controller = module.get(FcUnspentMohuaReviewController);
  });

  it('GET :stateId/:yearId delegates to FcUnspentMohuaReviewService.getReviewMetadata', async () => {
    await controller.getReview(stateId, yearId, user);
    expect(reviewService['getReviewMetadata']).toHaveBeenCalledWith(stateId, yearId, user);
  });

  it('GET :stateId/:yearId/rows delegates to FcUnspentMohuaRowsService.getRows', async () => {
    const query = { page: 1, limit: 20 };
    await controller.getRows(stateId, yearId, query as never, user);
    expect(rowsService['getRows']).toHaveBeenCalledWith(stateId, yearId, query, user);
  });

  it('POST rows/approve delegates to FcUnspentMohuaRowsService.bulkApproveRows', async () => {
    const dto: BulkApproveFcUnspentRowsDto = { stateId, yearId, rowIds: [new Types.ObjectId().toString()] };
    await controller.bulkApproveRows(dto, user, '127.0.0.1', 'jest-agent');
    expect(rowsService['bulkApproveRows']).toHaveBeenCalledWith(dto, user, '127.0.0.1', 'jest-agent');
  });

  it('POST rows/reject delegates to FcUnspentMohuaRowsService.bulkRejectRows', async () => {
    const dto: BulkRejectFcUnspentRowsDto = {
      stateId,
      yearId,
      rows: [{ rowId: new Types.ObjectId().toString(), rejectionRemark: 'Bad allocation.' }],
    };
    await controller.bulkRejectRows(dto, user, '127.0.0.1', 'jest-agent');
    expect(rowsService['bulkRejectRows']).toHaveBeenCalledWith(dto, user, '127.0.0.1', 'jest-agent');
  });

  it('POST :stateId/:yearId/approve delegates to FcUnspentMohuaReviewService.approveCompleteForm', async () => {
    await controller.approveForm(stateId, yearId, user, '127.0.0.1', 'jest-agent');
    expect(reviewService['approveCompleteForm']).toHaveBeenCalledWith(stateId, yearId, user, '127.0.0.1', 'jest-agent');
  });

  it('POST :stateId/:yearId/reject delegates to FcUnspentMohuaReviewService.rejectCompleteForm', async () => {
    await controller.rejectForm(stateId, yearId, { mohuaRemarks: 'Please redo.' }, user, '127.0.0.1', 'jest-agent');
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
