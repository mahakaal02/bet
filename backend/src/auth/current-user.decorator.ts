import { ExecutionContext, createParamDecorator } from '@nestjs/common';

export interface AuthedUser {
  id: string;
  email: string | null;
  username: string;
  emailVerified: boolean;
  coinBalance: number;
  isAdmin: boolean;
}

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthedUser => {
    const req = ctx.switchToHttp().getRequest();
    return req.user as AuthedUser;
  },
);
