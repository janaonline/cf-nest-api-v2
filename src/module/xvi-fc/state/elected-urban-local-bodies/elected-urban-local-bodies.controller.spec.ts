import { StreamableFile } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { AccessLevel, Scope, UserRole } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { ElectedUrbanLocalBodiesController } from './elected-urban-local-bodies.controller';
import { ElectedUrbanLocalBodiesExcelService } from './elected-urban-local-bodies-excel.service';
import { EulbPostSubmissionUpdateService } from './elected-urban-local-bodies-post-submission-update.service';
import { ElectedUrbanLocalBodiesRowService } from './elected-urban-local-bodies-row.service';
import { ElectedUrbanLocalBodiesService } from './elected-urban-local-bodies.service';

describe('ElectedUrbanLocalBodiesController', () => {
  const stateId = new Types.ObjectId().toString();
  const yearId = new Types.ObjectId().toString();
  const user: AuthUser = {
    _id: new Types.ObjectId().toString(),
    role: UserRole.ADMIN,
    scope: Scope.ADMIN,
    accessLevel: AccessLevel.ADMIN,
    state: null,
  };

  let controller: ElectedUrbanLocalBodiesController;
  let eulbService: { dumpToExcel: jest.Mock<Promise<Buffer>, [string, string, AuthUser]> };

  beforeEach(async () => {
    eulbService = {
      dumpToExcel: jest.fn<Promise<Buffer>, [string, string, AuthUser]>().mockResolvedValue(Buffer.from('excel')),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ElectedUrbanLocalBodiesController],
      providers: [
        { provide: ElectedUrbanLocalBodiesService, useValue: eulbService },
        { provide: ElectedUrbanLocalBodiesExcelService, useValue: {} },
        { provide: ElectedUrbanLocalBodiesRowService, useValue: {} },
        { provide: EulbPostSubmissionUpdateService, useValue: {} },
      ],
    }).compile();

    controller = module.get<ElectedUrbanLocalBodiesController>(ElectedUrbanLocalBodiesController);
  });

  it('calls the service and returns an Excel StreamableFile with the correct MIME type', async () => {
    const result = await controller.dump(stateId, yearId, user);
    const headers = result.getHeaders();

    expect(eulbService.dumpToExcel).toHaveBeenCalledWith(stateId, yearId, user);
    expect(result).toBeInstanceOf(StreamableFile);
    expect(headers.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(headers.disposition).toMatch(/^attachment; filename="elected-body-data-dump_/);
    expect(headers.disposition).toMatch(/\.xlsx"$/);
  });
});
