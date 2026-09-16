import { Test, TestingModule } from '@nestjs/testing';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { RequestExemptionController } from './request-exemption.controller';
import { RequestExemptionService } from './request-exemption.service';
import { SaveRequestExemptionDto } from './dto/save-request-exemption.dto';
import { GetRequestExemptionListQueryDto } from './dto/get-request-exemption-list-query.dto';

describe('RequestExemptionController', () => {
  let controller: RequestExemptionController;
  let service: { getForm: jest.Mock; finalSubmit: jest.Mock; list: jest.Mock };

  const user = { _id: 'user-id' } as unknown as AuthUser;

  beforeEach(async () => {
    service = {
      getForm: jest.fn().mockResolvedValue({ success: true }),
      finalSubmit: jest.fn().mockResolvedValue({ success: true }),
      list: jest.fn().mockResolvedValue({ success: true }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RequestExemptionController],
      providers: [{ provide: RequestExemptionService, useValue: service }],
    }).compile();

    controller = module.get(RequestExemptionController);
  });

  it('getForm delegates to the service with the route params and current user', async () => {
    await controller.getForm('state-id', 'year-id', user);
    expect(service.getForm).toHaveBeenCalledWith('state-id', 'year-id', user);
  });

  it('finalSubmit delegates to the service with the body, user, ip, and user-agent', async () => {
    const dto = { stateId: 'state-id', yearId: 'year-id', data: {} } as SaveRequestExemptionDto;
    await controller.finalSubmit(dto, user, '127.0.0.1', 'jest');
    expect(service.finalSubmit).toHaveBeenCalledWith(dto, user, '127.0.0.1', 'jest');
  });

  it('list delegates to the service with the route params, query, and current user', async () => {
    const query = { page: 1, limit: 10 } as GetRequestExemptionListQueryDto;
    await controller.list('state-id', 'year-id', query, user);
    expect(service.list).toHaveBeenCalledWith('state-id', 'year-id', query, user);
  });
});
