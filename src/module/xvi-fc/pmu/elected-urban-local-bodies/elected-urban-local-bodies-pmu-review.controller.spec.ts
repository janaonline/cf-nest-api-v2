import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { AccessLevel, Scope, UserRole } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { ElectedUrbanLocalBodiesPmuReviewController } from './elected-urban-local-bodies-pmu-review.controller';
import { ElectedUrbanLocalBodiesPmuReviewService } from './services/elected-urban-local-bodies-pmu-review.service';
import { ElectedUrbanLocalBodiesPmuRowsService } from './services/elected-urban-local-bodies-pmu-rows.service';
import type { BulkApprovePmuRowsDto } from 'src/module/xvi-fc/common/dto/bulk-approve-pmu-rows.dto';
import type { BulkRejectPmuRowsDto } from 'src/module/xvi-fc/common/dto/bulk-reject-pmu-rows.dto';

describe('ElectedUrbanLocalBodiesPmuReviewController', () => {
  const stateId = new Types.ObjectId().toString();
  const yearId = new Types.ObjectId().toString();
  const user: AuthUser = {
    _id: new Types.ObjectId().toString(),
    role: UserRole.ADMIN,
    scope: Scope.ADMIN,
    accessLevel: AccessLevel.ADMIN,
    state: null,
  };

  let controller: ElectedUrbanLocalBodiesPmuReviewController;
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
      controllers: [ElectedUrbanLocalBodiesPmuReviewController],
      providers: [
        { provide: ElectedUrbanLocalBodiesPmuReviewService, useValue: reviewService },
        { provide: ElectedUrbanLocalBodiesPmuRowsService, useValue: rowsService },
      ],
    }).compile();

    controller = module.get(ElectedUrbanLocalBodiesPmuReviewController);
  });

  it('GET worklist/:yearId delegates to ElectedUrbanLocalBodiesPmuReviewService.getWorklist', async () => {
    const query = { page: 1, limit: 20 };
    await controller.getWorklist(yearId, query, user);
    expect(reviewService['getWorklist']).toHaveBeenCalledWith(yearId, query, user);
  });

  it('GET :stateId/:yearId delegates to ElectedUrbanLocalBodiesPmuReviewService.getReviewMetadata', async () => {
    await controller.getReview(stateId, yearId, user);
    expect(reviewService['getReviewMetadata']).toHaveBeenCalledWith(stateId, yearId, user);
  });

  it('GET :stateId/:yearId/rows delegates to ElectedUrbanLocalBodiesPmuRowsService.getRows', async () => {
    const query = { page: 1, limit: 20 };
    await controller.getRows(stateId, yearId, query as never, user);
    expect(rowsService['getRows']).toHaveBeenCalledWith(stateId, yearId, query, user);
  });

  it('POST rows/approve delegates to ElectedUrbanLocalBodiesPmuRowsService.bulkApproveRows', async () => {
    const dto: BulkApprovePmuRowsDto = { stateId, yearId, rowIds: [new Types.ObjectId().toString()] };
    await controller.bulkApproveRows(dto, user, '127.0.0.1', 'jest-agent');
    expect(rowsService['bulkApproveRows']).toHaveBeenCalledWith(dto, user, '127.0.0.1', 'jest-agent');
  });

  it('POST rows/reject delegates to ElectedUrbanLocalBodiesPmuRowsService.bulkRejectRows', async () => {
    const dto: BulkRejectPmuRowsDto = {
      stateId,
      yearId,
      rows: [{ rowId: new Types.ObjectId().toString(), rejectionRemark: 'Dates do not match the registry.' }],
    };
    await controller.bulkRejectRows(dto, user, '127.0.0.1', 'jest-agent');
    expect(rowsService['bulkRejectRows']).toHaveBeenCalledWith(dto, user, '127.0.0.1', 'jest-agent');
  });

  it('POST :stateId/:yearId/approve delegates to ElectedUrbanLocalBodiesPmuReviewService.approveCompleteForm', async () => {
    await controller.approveForm(stateId, yearId, user, '127.0.0.1', 'jest-agent');
    expect(reviewService['approveCompleteForm']).toHaveBeenCalledWith(stateId, yearId, user, '127.0.0.1', 'jest-agent');
  });

  it('POST :stateId/:yearId/reject delegates to ElectedUrbanLocalBodiesPmuReviewService.rejectCompleteForm', async () => {
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
