import { CanActivate, ExecutionContext, Injectable, SetMetadata, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { forbid } from './errors';

export interface AuthUser {
  id: string; login: string; name: string; role: UserRole; contractorId: string | null; clientId: string | null;
}

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);
export const ROLES = 'roles';
/** Ограничить эндпоинт ролями (RolesGuard). Без декоратора — любой вошедший пользователь. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES, roles);
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user);

/**
 * Глобальный guard: проверяет JWT (30 дней, без refresh), активность пользователя
 * и инвалидацию по passwordChangedAt, затем роли из @Roles.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private jwt: JwtService, private prisma: PrismaService, private reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    const req = ctx.switchToHttp().getRequest();
    const header: string = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : (req.query?.token as string | undefined);
    if (!token) throw new UnauthorizedException('Требуется вход в систему');
    let payload: { sub: string; iat: number };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('Сессия истекла — войдите заново');
    }
    const u = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!u || !u.active) throw new UnauthorizedException('Пользователь заблокирован');
    // iat — в секундах; токены, выданные до смены пароля, недействительны
    if (payload.iat * 1000 < Math.floor(u.passwordChangedAt.getTime() / 1000) * 1000) {
      throw new UnauthorizedException('Пароль был изменён — войдите заново');
    }
    req.user = { id: u.id, login: u.login, name: u.name, role: u.role, contractorId: u.contractorId, clientId: u.clientId } satisfies AuthUser;
    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES, targets);
    if (roles?.length && !roles.includes(u.role)) forbid();
    return true;
  }
}

export const isStaff = (r: UserRole) => r === 'GC' || r === 'MANAGER';
