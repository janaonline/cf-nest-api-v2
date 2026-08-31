import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { NotificationAudienceResolver } from './notification-audience.resolver';
import { User } from '../../../schemas/user/user.schema';
import { INotificationAudience } from '../../../common/types/workflow.types';

describe('NotificationAudienceResolver', () => {
  let resolver: NotificationAudienceResolver;
  let mockUserModel: { find: jest.Mock; select: jest.Mock; lean: jest.Mock; exec: jest.Mock };

  function mockUsers(ids: Types.ObjectId[]): void {
    mockUserModel.exec.mockResolvedValue(ids.map((_id) => ({ _id })));
  }

  beforeEach(async () => {
    mockUserModel = {
      find: jest.fn(),
      select: jest.fn(),
      lean: jest.fn(),
      exec: jest.fn(),
    };
    mockUserModel.find.mockReturnValue(mockUserModel);
    mockUserModel.select.mockReturnValue(mockUserModel);
    mockUserModel.lean.mockReturnValue(mockUserModel);
    mockUserModel.exec.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [NotificationAudienceResolver, { provide: getModelToken(User.name), useValue: mockUserModel }],
    }).compile();

    resolver = module.get<NotificationAudienceResolver>(NotificationAudienceResolver);
  });

  afterEach(() => jest.clearAllMocks());

  it('is defined', () => {
    expect(resolver).toBeDefined();
  });

  it('returns de-duplicated userIds as-is, without querying the User model', async () => {
    const result = await resolver.resolveAudience({ userIds: ['u1', 'u2', 'u1'] });

    expect(result).toEqual(['u1', 'u2']);
    expect(mockUserModel.find).not.toHaveBeenCalled();
  });

  it('scopes to a specific ULB when orgType is ULB and orgId is provided', async () => {
    const ulbId = new Types.ObjectId();
    const userId = new Types.ObjectId();
    mockUsers([userId]);

    const result = await resolver.resolveAudience({ orgType: 'ULB', orgId: ulbId.toString() });

    const query = mockUserModel.find.mock.calls[0][0];
    expect(query.role).toBe('ULB');
    expect(query.ulb.toString()).toBe(ulbId.toString());
    expect(result).toEqual([userId.toString()]);
  });

  it('scopes to a specific STATE when orgType is STATE and orgId is provided', async () => {
    const stateId = new Types.ObjectId();
    mockUsers([]);

    await resolver.resolveAudience({ orgType: 'STATE', orgId: stateId.toString() });

    const query = mockUserModel.find.mock.calls[0][0];
    expect(query.role).toBe('STATE');
    expect(query.state.toString()).toBe(stateId.toString());
  });

  it('filters by roleCodes when provided', async () => {
    mockUsers([]);

    await resolver.resolveAudience({ roleCodes: ['STATE', 'ADMIN'] });

    const query = mockUserModel.find.mock.calls[0][0];
    expect(query.role).toEqual({ $in: ['STATE', 'ADMIN'] });
  });

  // The one legitimate org-agnostic broadcast in the codebase (form-workflow.service.ts notifying
  // every MoHUA reviewer) — MoHUA has no org/state/ULB scoping concept, so omitting orgId here is
  // intentional and must keep matching every active MoHUA user, not be treated as the #26 bug.
  it('broadcasts to every user with that role when orgType has no org-scoping concept (e.g. MoHUA) and orgId is omitted', async () => {
    const userId = new Types.ObjectId();
    mockUsers([userId]);

    const result = await resolver.resolveAudience({ orgType: 'MoHUA' });

    const query = mockUserModel.find.mock.calls[0][0];
    expect(query.role).toBe('MoHUA');
    expect(query.ulb).toBeUndefined();
    expect(query.state).toBeUndefined();
    expect(result).toEqual([userId.toString()]);
  });

  // Regression for PR #210 finding #26: orgType STATE/ULB implies org-scoped targeting: a missing
  // orgId (e.g. a form submission with no stateId/ulbId) is a caller bug, not a broadcast — must
  // fail closed (no recipients) instead of silently matching every user with that role.
  it.each<INotificationAudience['orgType']>(['STATE', 'ULB'])(
    'fails closed (returns no recipients) when orgType is %s but orgId is missing',
    async (orgType) => {
      const result = await resolver.resolveAudience({ orgType });

      expect(result).toEqual([]);
      expect(mockUserModel.find).not.toHaveBeenCalled();
    },
  );

  it('fails closed when orgType is STATE and orgId is an empty string (falsy)', async () => {
    const result = await resolver.resolveAudience({ orgType: 'STATE', orgId: '' });

    expect(result).toEqual([]);
    expect(mockUserModel.find).not.toHaveBeenCalled();
  });
});
