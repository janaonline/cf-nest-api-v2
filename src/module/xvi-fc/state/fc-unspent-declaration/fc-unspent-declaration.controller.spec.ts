import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { AccessLevel, Scope, UserRole } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { FcUnspentDeclarationController } from './fc-unspent-declaration.controller';
import { FcUnspentDeclarationService } from './services/main/fc-unspent-declaration.service';
import { FcUnspentUlbOptionsService } from './services/ulb-options/fc-unspent-ulb-options.service';
import type { SaveFcUnspentDeclarationDto } from './dto/save-fc-unspent-declaration.dto';

describe('FcUnspentDeclarationController', () => {
  const stateId = new Types.ObjectId().toString();
  const yearId = new Types.ObjectId().toString();
  const user: AuthUser = {
    _id: new Types.ObjectId().toString(),
    role: UserRole.ADMIN,
    scope: Scope.ADMIN,
    accessLevel: AccessLevel.ADMIN,
    state: null,
  };

  let controller: FcUnspentDeclarationController;
  let mainService: Record<string, jest.Mock>;
  let ulbOptionsService: Record<string, jest.Mock>;

  beforeEach(async () => {
    mainService = {
      getForm: jest.fn().mockResolvedValue({ success: true }),
      saveDraft: jest.fn().mockResolvedValue({ success: true }),
      finalSubmit: jest.fn().mockResolvedValue({ success: true }),
      getDeclarationTemplate: jest.fn().mockResolvedValue({ success: true }),
    };
    ulbOptionsService = {
      getOptions: jest.fn().mockResolvedValue({ success: true, data: [] }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FcUnspentDeclarationController],
      providers: [
        { provide: FcUnspentDeclarationService, useValue: mainService },
        { provide: FcUnspentUlbOptionsService, useValue: ulbOptionsService },
      ],
    }).compile();

    controller = module.get(FcUnspentDeclarationController);
  });

  it('GET :stateId/:yearId delegates to FcUnspentDeclarationService.getForm', async () => {
    await controller.getForm(stateId, yearId, user);
    expect(mainService['getForm']).toHaveBeenCalledWith(stateId, yearId, user);
  });

  it('GET :stateId/:yearId/ulb-options delegates to FcUnspentUlbOptionsService.getOptions', async () => {
    const query = { search: 'a', page: 1, limit: 10 };
    await controller.getUlbOptions(stateId, yearId, query, user);
    expect(ulbOptionsService['getOptions']).toHaveBeenCalledWith(stateId, yearId, query, user);
  });

  it('POST save-draft delegates to FcUnspentDeclarationService.saveDraft (no ip/userAgent — no history on draft)', async () => {
    const dto = { stateId, yearId, data: { isFcUnspent: false } } as unknown as SaveFcUnspentDeclarationDto;
    await controller.saveDraft(dto, user);
    expect(mainService['saveDraft']).toHaveBeenCalledWith(dto, user);
  });

  it('POST final-submit delegates to FcUnspentDeclarationService.finalSubmit with ip/userAgent', async () => {
    const dto = { stateId, yearId, data: { isFcUnspent: false } } as unknown as SaveFcUnspentDeclarationDto;
    await controller.finalSubmit(dto, user, '127.0.0.1', 'jest-agent');
    expect(mainService['finalSubmit']).toHaveBeenCalledWith(dto, user, '127.0.0.1', 'jest-agent');
  });

  it('GET :stateId/:yearId/declaration-template delegates to FcUnspentDeclarationService.getDeclarationTemplate', async () => {
    await controller.getDeclarationTemplate(stateId, yearId, user);
    expect(mainService['getDeclarationTemplate']).toHaveBeenCalledWith(stateId, yearId, user);
  });
});
