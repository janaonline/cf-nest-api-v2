import { UserDocument } from 'src/schemas/user/user.schema';
import { StateDocument } from 'src/schemas/state.schema';
import { UlbDocument } from 'src/schemas/ulb.schema';
import { Role } from './enum/role.enum';
import { parseUserRole } from './roles-xvi-fc.helper';

/**
 * Builds the `user` object returned by both /auth/login and /auth/refresh — the single source of
 * truth for these derived fields (stateName, stateCode, ulbCode, isUA, isMillionPlus, accessLevel)
 * so the two endpoints can never drift out of sync again. Previously /auth/refresh used a separate,
 * much simpler serializer that never fetched state/ulb at all, so stateName (and the rest of these
 * fields) silently disappeared from the frontend's cached user every time the access token
 * silently refreshed.
 */
export function buildUserResponsePayload(
  user: UserDocument,
  state: StateDocument | null,
  ulb: UlbDocument | null,
): Record<string, unknown> {
  const parsedRole = parseUserRole(
    user.role as unknown as Parameters<typeof parseUserRole>[0],
    user.xviFcSubrole as string | null | undefined,
  );

  return {
    _id: user._id,
    name: user.name,
    email: user.email,
    mobile: user.mobile,
    isActive: user.isActive,
    role: user.role,
    ...(parsedRole && { accessLevel: parsedRole.accessLevel }),
    isXVIFCProfileVerified: user.isXVIFCProfileVerified ?? false,
    isNewUser: user.isNewUser ?? false,
    state: user.state,
    stateName: state?.name ?? null,
    designation: user.designation,
    ulb: user.ulb,
    ulbCode: user.role === Role.ULB ? (ulb?.code ?? '') : '',
    stateCode: user.role === Role.STATE || user.role === Role.ULB ? (state?.code ?? '') : '',
    isUA: user.role === Role.ULB ? (ulb?.isUA ?? null) : null,
    isMillionPlus: user.role === Role.ULB ? (ulb?.isMillionPlus ?? null) : null,
    isUserVerified2223: user.isVerified2223,
  };
}
