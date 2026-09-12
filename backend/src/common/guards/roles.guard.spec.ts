import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard, ROLES_KEY } from '../guards/roles.guard';
import { UserRole } from '../../modules/users/user.entity';

function makeContext(authUser?: { role: UserRole }): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ authUser }),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  it('permite quando a rota não declara @Roles()', () => {
    const reflector = { getAllAndOverride: () => undefined } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(makeContext({ role: UserRole.EMPLOYEE }))).toBe(true);
  });

  it('permite quando o papel do usuário está na lista exigida', () => {
    const reflector = {
      getAllAndOverride: () => [UserRole.MANAGER, UserRole.EMPLOYEE],
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(makeContext({ role: UserRole.MANAGER }))).toBe(true);
  });

  it('bloqueia quando o papel do usuário não está na lista exigida', () => {
    const reflector = {
      getAllAndOverride: () => [UserRole.MASTER_ADMIN],
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(() => guard.canActivate(makeContext({ role: UserRole.MANAGER }))).toThrow(
      ForbiddenException,
    );
  });

  it('bloqueia quando não há usuário autenticado na requisição', () => {
    const reflector = {
      getAllAndOverride: () => [UserRole.MANAGER],
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(() => guard.canActivate(makeContext(undefined))).toThrow(ForbiddenException);
  });

  it('expõe a metadata key esperada pelo decorator @Roles', () => {
    expect(ROLES_KEY).toBe('roles');
  });
});
