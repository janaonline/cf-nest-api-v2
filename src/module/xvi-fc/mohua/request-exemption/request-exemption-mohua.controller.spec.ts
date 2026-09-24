import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { AccessLevel, Scope, UserRole } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { RequestExemptionMohuaController } from './request-exemption-mohua.controller';
import { RequestExemptionMohuaService } from './request-exemption-mohua.service';

describe('RequestExemptionMohuaController', () => {
  const requestId = new Types.ObjectId().toString();
  const user: AuthUser = {
    _id: new Types.ObjectId().toString(),
    role: UserRole.ADMIN,
    scope: Scope.ADMIN,
    accessLevel: AccessLevel.ADMIN,
    state: null,
  };

  let controller: RequestExemptionMohuaController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = {
      approve: jest.fn().mockResolvedValue({ success: true }),
      reject: jest.fn().mockResolvedValue({ success: true }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RequestExemptionMohuaController],
      providers: [{ provide: RequestExemptionMohuaService, useValue: service }],
    }).compile();

    controller = module.get(RequestExemptionMohuaController);
  });

  it('POST :requestId/:formId/approve delegates to RequestExemptionMohuaService.approve', async () => {
    await controller.approve(requestId, 30, user, '127.0.0.1', 'jest-agent');

    expect(service['approve']).toHaveBeenCalledWith(requestId, 30, user, '127.0.0.1', 'jest-agent');
  });

  it('POST :requestId/:formId/reject delegates to RequestExemptionMohuaService.reject', async () => {
    await controller.reject(requestId, 31, { mohuaRemarks: 'Missing signature.' }, user, '127.0.0.1', 'jest-agent');

    expect(service['reject']).toHaveBeenCalledWith(
      requestId,
      31,
      'Missing signature.',
      user,
      '127.0.0.1',
      'jest-agent',
    );
  });
});
