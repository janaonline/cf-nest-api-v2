import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { XviFcUlbOptionsController } from './xvi-fc-ulb-options.controller';
import { XviFcUlbOptionsService } from './services/xvi-fc-ulb-options.service';
import { GetUlbOptionsQueryDto } from './dto/get-ulb-options-query.dto';

describe('XviFcUlbOptionsController', () => {
  let controller: XviFcUlbOptionsController;
  let service: { getOptions: jest.Mock };

  const stateOid = new Types.ObjectId();
  const stateUser = { _id: 'user-id', scope: Scope.STATE, state: stateOid } as unknown as AuthUser;
  const otherStateUser = { _id: 'user-id-2', scope: Scope.STATE, state: new Types.ObjectId() } as unknown as AuthUser;

  beforeEach(async () => {
    service = { getOptions: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [XviFcUlbOptionsController],
      providers: [{ provide: XviFcUlbOptionsService, useValue: service }],
    }).compile();

    controller = module.get(XviFcUlbOptionsController);
  });

  it('delegates to the service with the query params', async () => {
    const query: GetUlbOptionsQueryDto = { stateId: stateOid.toString(), yearId: 'year-id', search: 'agra', limit: 5 };
    await controller.getOptions(query, stateUser);

    expect(service.getOptions).toHaveBeenCalledWith(stateOid.toString(), 'year-id', 'agra', 5);
  });

  it('rejects a state user requesting a different state', async () => {
    const query: GetUlbOptionsQueryDto = { stateId: stateOid.toString(), yearId: 'year-id' };
    await expect(controller.getOptions(query, otherStateUser)).rejects.toThrow(ForbiddenException);
    expect(service.getOptions).not.toHaveBeenCalled();
  });
});
