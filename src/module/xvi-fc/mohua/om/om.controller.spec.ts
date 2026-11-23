import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { OmController } from './om.controller';

const user = (scope: Scope): AuthUser => ({ _id: 'u1', role: 'MoHUA', scope, accessLevel: null });

describe('OmController', () => {
  let service: {
    getEditor: jest.Mock;
    history: jest.Mock;
    listStates: jest.Mock;
    saveDraft: jest.Mock;
    generate: jest.Mock;
    uploadSignedFile: jest.Mock;
  };
  let controller: OmController;

  beforeEach(() => {
    service = {
      getEditor: jest.fn().mockResolvedValue({ omId: null }),
      history: jest.fn().mockResolvedValue([]),
      listStates: jest.fn().mockResolvedValue({ states: [] }),
      saveDraft: jest.fn().mockResolvedValue({}),
      generate: jest.fn(),
      uploadSignedFile: jest.fn().mockResolvedValue({}),
    };
    controller = new OmController(service as never);
  });

  it.each([Scope.MOHUA, Scope.DOE, Scope.PMU, Scope.ADMIN])('lets %s read the OM list, one OM and the history', async (scope) => {
    await expect(controller.listStates('y1', 1, user(scope))).resolves.toMatchObject({ success: true });
    await expect(controller.getEditor('c1', user(scope))).resolves.toMatchObject({ success: true });
    await expect(controller.history('y1', 1, user(scope))).resolves.toMatchObject({ success: true });
  });

  it.each([Scope.STATE, Scope.ULB])('refuses %s every OM read before reading anything', async (scope) => {
    await expect(() => controller.listStates('y1', 1, user(scope))).rejects.toThrow(ForbiddenException);
    await expect(() => controller.getEditor('c1', user(scope))).rejects.toThrow(ForbiddenException);
    await expect(() => controller.history('y1', 1, user(scope))).rejects.toThrow(ForbiddenException);
    await expect(() => controller.downloadPdf('o1', user(scope))).rejects.toThrow(ForbiddenException);
    expect(service.history).not.toHaveBeenCalled();
  });

  it.each([Scope.PMU, Scope.DOE])('refuses %s every OM write: PMU and DoE only monitor', async (scope) => {
    await expect(() => controller.saveDraft('c1', {} as never, user(scope))).rejects.toThrow(ForbiddenException);
    await expect(() => controller.generate('c1', user(scope), '1.2.3.4', 'jest')).rejects.toThrow(ForbiddenException);
    await expect(() =>
      controller.uploadSignedFile('o1', {} as never, user(scope), '1.2.3.4', 'jest'),
    ).rejects.toThrow(ForbiddenException);
    expect(service.saveDraft).not.toHaveBeenCalled();
    expect(service.generate).not.toHaveBeenCalled();
    expect(service.uploadSignedFile).not.toHaveBeenCalled();
  });
});
