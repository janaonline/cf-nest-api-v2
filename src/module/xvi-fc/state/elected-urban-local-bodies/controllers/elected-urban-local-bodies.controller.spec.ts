import { StreamableFile } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { AccessLevel, Permission, Scope, UserRole } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { REQUIRED_PERMISSIONS_KEY } from 'src/module/auth/require-permissions.decorator';
import { ElectedUrbanLocalBodiesController } from 'src/module/xvi-fc/state/elected-urban-local-bodies/controllers/elected-urban-local-bodies.controller';
import { ElectedUrbanLocalBodiesExcelService } from 'src/module/xvi-fc/state/elected-urban-local-bodies/services/excel/elected-urban-local-bodies-excel.service';
import { EulbPostSubmissionUpdateService } from 'src/module/xvi-fc/state/elected-urban-local-bodies/services/post-submission-update/elected-urban-local-bodies-post-submission-update.service';
import { ElectedUrbanLocalBodiesRowService } from 'src/module/xvi-fc/state/elected-urban-local-bodies/services/row/elected-urban-local-bodies-row.service';
import { ElectedUrbanLocalBodiesService } from 'src/module/xvi-fc/state/elected-urban-local-bodies/services/main/elected-urban-local-bodies.service';
import { ElectedUrbanLocalBodiesDocxService } from 'src/module/xvi-fc/state/elected-urban-local-bodies/services/document/elected-urban-local-bodies-docx.service';

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
  let eulbDocxService: {
    generateElectedBodiesListDocument: jest.Mock<
      Promise<{ buffer: Buffer; fileName: string }>,
      [string, string, AuthUser]
    >;
  };

  beforeEach(async () => {
    eulbService = {
      dumpToExcel: jest.fn<Promise<Buffer>, [string, string, AuthUser]>().mockResolvedValue(Buffer.from('excel')),
    };
    eulbDocxService = {
      generateElectedBodiesListDocument: jest
        .fn<Promise<{ buffer: Buffer; fileName: string }>, [string, string, AuthUser]>()
        .mockResolvedValue({ buffer: Buffer.from('docx'), fileName: 'elected-bodies-list_2026-01-01.docx' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ElectedUrbanLocalBodiesController],
      providers: [
        { provide: ElectedUrbanLocalBodiesService, useValue: eulbService },
        { provide: ElectedUrbanLocalBodiesExcelService, useValue: {} },
        { provide: ElectedUrbanLocalBodiesRowService, useValue: {} },
        { provide: EulbPostSubmissionUpdateService, useValue: {} },
        { provide: ElectedUrbanLocalBodiesDocxService, useValue: eulbDocxService },
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

  it('calls the docx service and returns a Word StreamableFile with the correct MIME type and filename', async () => {
    const result = await controller.getElectedBodiesListDocument(stateId, yearId, user);
    const headers = result.getHeaders();

    expect(eulbDocxService.generateElectedBodiesListDocument).toHaveBeenCalledWith(stateId, yearId, user);
    expect(result).toBeInstanceOf(StreamableFile);
    expect(headers.type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(headers.disposition).toBe('attachment; filename="elected-bodies-list_2026-01-01.docx"');
  });

  describe('post-submission-update permission gates', () => {
    // Regression guard for a real authorization gap: these two routes previously required
    // only VIEW_STATE_FORMS, which let a view-only state user mutate row data via
    // post-submission-update (see also EulbPostSubmissionUpdateService.buildPermissions).
    it('requires EDIT_STATE_FORMS on the validate route', () => {
      const perms = Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, controller.validatePostSubmissionUpdateBatch);
      expect(perms).toEqual([Permission.EDIT_STATE_FORMS]);
    });

    it('requires FINAL_SUBMIT_STATE_FORMS on the submit route', () => {
      const perms = Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, controller.submitPostSubmissionUpdateBatch);
      expect(perms).toEqual([Permission.FINAL_SUBMIT_STATE_FORMS]);
    });

    it('leaves the read-only metadata and rows routes on VIEW_STATE_FORMS', () => {
      expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, controller.getPostSubmissionUpdateMetadata)).toEqual([
        Permission.VIEW_STATE_FORMS,
      ]);
      expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, controller.getPostSubmissionUpdateRows)).toEqual([
        Permission.VIEW_STATE_FORMS,
      ]);
    });
  });
});
