import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { AccessLevel, Scope, UserRole } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { FcUnspentPmuReviewController } from './fc-unspent-pmu-review.controller';
import { FcUnspentPmuReviewService } from './services/fc-unspent-pmu-review.service';
import { FcUnspentPmuRowsService } from './services/fc-unspent-pmu-rows.service';
import type { BulkApprovePmuRowsDto } from 'src/module/xvi-fc/common/dto/bulk-approve-pmu-rows.dto';
import type { BulkRejectPmuRowsDto } from 'src/module/xvi-fc/common/dto/bulk-reject-pmu-rows.dto';

describe('FcUnspentPmuReviewController', () => {
  const stateId = new Types.ObjectId().toString();
  const yearId = new Types.ObjectId().toString();
  const user: AuthUser = {
    _id: new Types.ObjectId().toString(),
    role: UserRole.ADMIN,
    scope: Scope.ADMIN,
    accessLevel: AccessLevel.ADMIN,
    state: null,
  };

  let controller: FcUnspentPmuReviewController;
  let reviewService: Record<string, jest.Mock>;
  let rowsService: Record<string, jest.Mock>;

  beforeEach(async () => {
    reviewService = {
      getWorklist: jest.fn().mockResolvedValue({ success: true }),
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
      controllers: [FcUnspentPmuReviewController],
      providers: [
        { provide: FcUnspentPmuReviewService, useValue: reviewService },
        { provide: FcUnspentPmuRowsService, useValue: rowsService },
      ],
    }).compile();

    controller = module.get(FcUnspentPmuReviewController);
  });

  it('GET worklist/:yearId delegates to FcUnspentPmuReviewService.getWorklist', async () => {
    await controller.getWorklist(yearId, user);
    expect(reviewService['getWorklist']).toHaveBeenCalledWith(yearId, user);
  });

  it('GET :stateId/:yearId delegates to FcUnspentPmuReviewService.getReviewMetadata', async () => {
    await controller.getReview(stateId, yearId, user);
    expect(reviewService['getReviewMetadata']).toHaveBeenCalledWith(stateId, yearId, user);
  });

  it('GET :stateId/:yearId/rows delegates to FcUnspentPmuRowsService.getRows', async () => {
    const query = { page: 1, limit: 20 };
    await controller.getRows(stateId, yearId, query as never, user);
    expect(rowsService['getRows']).toHaveBeenCalledWith(stateId, yearId, query, user);
  });

  it('POST rows/approve delegates to FcUnspentPmuRowsService.bulkApproveRows', async () => {
    const dto: BulkApprovePmuRowsDto = { stateId, yearId, rowIds: [new Types.ObjectId().toString()] };
    await controller.bulkApproveRows(dto, user, '127.0.0.1', 'jest-agent');
    expect(rowsService['bulkApproveRows']).toHaveBeenCalledWith(dto, user, '127.0.0.1', 'jest-agent');
  });

  it('POST rows/reject delegates to FcUnspentPmuRowsService.bulkRejectRows', async () => {
    const dto: BulkRejectPmuRowsDto = {
      stateId,
      yearId,
      rows: [{ rowId: new Types.ObjectId().toString(), rejectionRemark: 'Bad allocation.' }],
    };
    await controller.bulkRejectRows(dto, user, '127.0.0.1', 'jest-agent');
    expect(rowsService['bulkRejectRows']).toHaveBeenCalledWith(dto, user, '127.0.0.1', 'jest-agent');
  });

  it('POST :stateId/:yearId/approve delegates to FcUnspentPmuReviewService.approveCompleteForm', async () => {
    await controller.approveForm(stateId, yearId, user, '127.0.0.1', 'jest-agent');
    expect(reviewService['approveCompleteForm']).toHaveBeenCalledWith(stateId, yearId, user, '127.0.0.1', 'jest-agent');
  });

  it('POST :stateId/:yearId/reject delegates to FcUnspentPmuReviewService.rejectCompleteForm', async () => {
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
