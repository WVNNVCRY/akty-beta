import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthUser, CurrentUser, Public } from '../common/auth';
import { biz } from '../common/errors';
import { hashPassword, verifyPassword } from '../common/password';
import { parse, z } from '../common/zod';
import { PrismaService } from '../prisma.service';

@Controller('auth')
export class AuthController {
  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  /** Логин + пароль → JWT на 30 дней (без refresh). Регистрации нет — пользователей создаёт GC. */
  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown) {
    const { login, password } = parse(z.object({ login: z.string().trim().min(1), password: z.string().min(1) }), body);
    const u = await this.prisma.user.findUnique({ where: { login } });
    if (!u || !u.active || !verifyPassword(password, u.passwordHash)) biz('Неверный логин или пароль');
    await this.prisma.user.update({ where: { id: u!.id }, data: { lastLoginAt: new Date() } });
    const token = await this.jwt.signAsync({ sub: u!.id });
    return { token, userId: u!.id };
  }

  @Get('me')
  me(@CurrentUser() u: AuthUser) {
    return u;
  }

  /** Смена своего пароля: старые токены перестают работать (passwordChangedAt). */
  @Post('password')
  @HttpCode(200)
  async changePassword(@CurrentUser() me: AuthUser, @Body() body: unknown) {
    const { oldPassword, newPassword } = parse(z.object({ oldPassword: z.string(), newPassword: z.string().min(6, 'минимум 6 символов') }), body);
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: me.id } });
    if (!verifyPassword(oldPassword, u.passwordHash)) biz('Текущий пароль указан неверно');
    // Отметка с точностью до секунды: JWT iat тоже в секундах
    const changedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
    await this.prisma.user.update({ where: { id: me.id }, data: { passwordHash: hashPassword(newPassword), passwordChangedAt: changedAt } });
    return { token: await this.jwt.signAsync({ sub: me.id }) };
  }
}
