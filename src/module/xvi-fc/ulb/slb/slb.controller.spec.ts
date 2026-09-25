import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { SlbController } from './slb.controller';
import { SlbService } from './slb.service';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import type { SaveSlbDto } from './dto/save-slb.dto';
import type { SlbUlbSubmissionsQueryDto } from './dto/slb-ulb-submissions-query.dto';

describe('SlbController', () => {
  let controller: SlbController;
  let service: Partial<Record<keyof SlbService, jest.Mock>>;

  const user: AuthUser = {
    _id: new Types.ObjectId().toString(),
    scope: Scope.ULB,
    ulb: new Types.ObjectId(),
  } as unknown as AuthUser;

  beforeEach(async () => {
    service = {
      getQuestions: jest.fn().mockResolvedValue({ success: true }),
      getForm: jest.fn().mockResolvedValue({ success: true }),
      saveDraft: jest.fn().mockResolvedValue({ success: true }),
      finalSubmit: jest.fn().mockResolvedValue({ success: true }),
      listUlbSlbForms: jest.fn().mockResolvedValue({ success: true }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SlbController],
      providers: [{ provide: SlbService, useValue: service }],
    }).compile();

    controller = module.get<SlbController>(SlbController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('getQuestions delegates to the service', () => {
    controller.getQuestions();
    expect(service.getQuestions).toHaveBeenCalled();
  });

  it('getForm delegates ulbId, yearId, and user', () => {
    const ulbId = new Types.ObjectId().toString();
    const yearId = new Types.ObjectId().toString();
    controller.getForm(ulbId, yearId, user);
    expect(service.getForm).toHaveBeenCalledWith(ulbId, yearId, user);
  });

  it('saveDraft delegates dto and user', () => {
    const dto: SaveSlbDto = { yearId: new Types.ObjectId().toString(), data: {} };
    controller.saveDraft(dto, user);
    expect(service.saveDraft).toHaveBeenCalledWith(dto, user);
  });

  it('finalSubmit delegates dto and user', () => {
    const dto: SaveSlbDto = { yearId: new Types.ObjectId().toString(), data: {} };
    controller.finalSubmit(dto, user);
    expect(service.finalSubmit).toHaveBeenCalledWith(dto, user);
  });

  it('listUlbSubmissions delegates dto and user', () => {
    const dto: SlbUlbSubmissionsQueryDto = {
      designYearId: new Types.ObjectId().toString(),
      page: 1,
      pageSize: 20,
    };
    controller.listUlbSubmissions(dto, user);
    expect(service.listUlbSlbForms).toHaveBeenCalledWith(dto, user);
  });
});
