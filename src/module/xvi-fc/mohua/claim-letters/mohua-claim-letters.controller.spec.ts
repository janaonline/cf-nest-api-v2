import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { MohuaClaimLettersController } from './mohua-claim-letters.controller';

const user = (scope: Scope): AuthUser => ({ _id: 'u1', role: 'MoHUA', scope, accessLevel: null });

describe('MohuaClaimLettersController', () => {
  let service: {
    listStates: jest.Mock;
    listStateClaimLetters: jest.Mock;
    getClaimLetter: jest.Mock;
    getClaimLetterUlbs: jest.Mock;
    approve: jest.Mock;
  };
  let controller: MohuaClaimLettersController;

  beforeEach(() => {
    service = {
      listStates: jest.fn().mockResolvedValue({ states: [] }),
      listStateClaimLetters: jest.fn().mockResolvedValue({ claimLetters: [] }),
      getClaimLetter: jest.fn().mockResolvedValue({ id: 'c1' }),
      getClaimLetterUlbs: jest.fn().mockResolvedValue({ items: [] }),
      approve: jest.fn().mockResolvedValue({ id: 'c1' }),
    };
    controller = new MohuaClaimLettersController(service as never);
  });

  it.each([Scope.MOHUA, Scope.DOE, Scope.ADMIN])('lets %s read every screen', async (scope) => {
    await expect(controller.listStates('y1', 1, user(scope))).resolves.toMatchObject({ success: true });
    await expect(controller.listStateClaimLetters('s1', 'y1', 1, user(scope))).resolves.toMatchObject({ success: true });
    await expect(controller.getClaimLetter('c1', user(scope))).resolves.toMatchObject({ success: true });
    await expect(controller.getClaimLetterUlbs('c1', {}, user(scope))).resolves.toMatchObject({ success: true });
  });

  it.each([Scope.STATE, Scope.ULB, Scope.PMU])('refuses %s on every screen before reading anything', async (scope) => {
    await expect(() => controller.listStates('y1', 1, user(scope))).rejects.toThrow(ForbiddenException);
    await expect(() => controller.listStateClaimLetters('s1', 'y1', 1, user(scope))).rejects.toThrow(ForbiddenException);
    await expect(() => controller.getClaimLetter('c1', user(scope))).rejects.toThrow(ForbiddenException);
    await expect(() => controller.getClaimLetterUlbs('c1', {}, user(scope))).rejects.toThrow(ForbiddenException);
    expect(service.listStates).not.toHaveBeenCalled();
    expect(service.getClaimLetter).not.toHaveBeenCalled();
  });

  it.each([Scope.MOHUA, Scope.ADMIN])('lets %s approve a claim letter', async (scope) => {
    await expect(
      controller.approve('c1', { expectedRevision: 3, remark: 'ok' }, user(scope), '1.2.3.4', 'jest'),
    ).resolves.toMatchObject({ success: true });
    expect(service.approve).toHaveBeenCalledWith('c1', 3, 'ok', user(scope), '1.2.3.4', 'jest');
  });

  it.each([Scope.DOE, Scope.STATE, Scope.ULB, Scope.PMU])('refuses %s approving a claim letter', async (scope) => {
    await expect(() =>
      controller.approve('c1', { expectedRevision: 3 }, user(scope), '1.2.3.4', 'jest'),
    ).rejects.toThrow(ForbiddenException);
    expect(service.approve).not.toHaveBeenCalled();
  });
});
