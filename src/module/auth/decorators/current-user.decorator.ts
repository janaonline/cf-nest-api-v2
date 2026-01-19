import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { User } from '../enum/role.enum';

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): User => {
  const request = ctx.switchToHttp().getRequest<{ user: User }>();
  return request.user;
});
