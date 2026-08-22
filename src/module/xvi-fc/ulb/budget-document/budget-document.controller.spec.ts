import { Types } from 'mongoose';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { AccessLevel, Scope, UserRole } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { BudgetDocumentController } from './budget-document.controller';
import { BudgetDocumentService } from './budget-document.service';
import type { UploadBudgetDocumentDto } from './dto/upload-budget-document.dto';

describe('BudgetDocumentController', () => {
  let controller: BudgetDocumentController;
  let service: { getByUlbAndYear: jest.Mock; upload: jest.Mock };

  const ulbId = new Types.ObjectId();
  const yearId = new Types.ObjectId().toString();

  const makeUser = (overrides: Partial<AuthUser> = {}): AuthUser =>
    ({
      _id: new Types.ObjectId().toString(),
      role: UserRole.ULB,
      scope: Scope.ULB,
      accessLevel: AccessLevel.ADMIN,
      ulb: ulbId,
      state: null,
      ...overrides,
    }) as AuthUser;

  beforeEach(() => {
    service = {
      getByUlbAndYear: jest.fn().mockResolvedValue({ data: { designYear: '2026-27', file: null } }),
      upload: jest.fn().mockResolvedValue({ data: { designYear: '2026-27', file: { name: 'Budget.pdf' } } }),
    };
    controller = new BudgetDocumentController(service as unknown as BudgetDocumentService);
  });

  afterEach(() => jest.clearAllMocks());

  it('delegates getBudgetDocument to the service with yearId and current user', async () => {
    const user = makeUser();

    const result = await controller.getBudgetDocument(yearId, user);

    expect(service.getByUlbAndYear).toHaveBeenCalledWith(user, yearId);
    expect(result).toMatchObject({ data: { designYear: '2026-27' } });
  });

  it('delegates uploadBudgetDocument to the service with dto and current user', async () => {
    const dto = { designYearId: yearId } as unknown as UploadBudgetDocumentDto;
    const user = makeUser();

    const result = await controller.uploadBudgetDocument(dto, user);

    expect(service.upload).toHaveBeenCalledWith(dto, user);
    expect(result).toMatchObject({ data: { file: { name: 'Budget.pdf' } } });
  });
});
