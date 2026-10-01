import { Injectable } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { AuthUser } from '../common/auth';
import { biz } from '../common/errors';
import { hashPassword } from '../common/password';
import { PrismaService } from '../prisma.service';
import { n, r2 } from '../workflow/helpers';

export interface UserInput {
  name: string; login: string; password?: string; role: UserRole; contractorId?: string | null; clientId?: string | null; active?: boolean;
}

/** Справочники и пользователи. Управление пользователями — только GC (п. 2 ТЗ). */
@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  async saveUser(me: AuthUser, id: string | null, v: UserInput) {
    if (v.role === 'CONTRACTOR' && !v.contractorId) biz('Для подрядчика выберите организацию');
    if (v.role === 'CLIENT' && !v.clientId) biz('Для заказчика выберите организацию');
    if (!id && !v.password) biz('Укажите пароль');
    if (v.password && v.password.length < 3) biz('Пароль слишком короткий');
    const dup = await this.prisma.user.findFirst({ where: { login: v.login, ...(id ? { id: { not: id } } : {}) } });
    if (dup) biz('Логин занят');
    if (id === me.id && (v.role !== 'GC' || v.active === false)) biz('Нельзя снять с себя роль генподрядчика или заблокировать себя');
    const data = {
      name: v.name, login: v.login, role: v.role, active: v.active ?? true,
      contractorId: v.role === 'CONTRACTOR' ? v.contractorId! : null,
      clientId: v.role === 'CLIENT' ? v.clientId! : null,
      // смена пароля завершает все старые сессии
      ...(v.password ? { passwordHash: hashPassword(v.password), passwordChangedAt: new Date(Math.floor(Date.now() / 1000) * 1000) } : {}),
    };
    if (id) {
      await this.prisma.user.update({ where: { id }, data });
      return { id, message: 'Сохранено' };
    }
    const u = await this.prisma.user.create({ data: { ...data, passwordHash: data.passwordHash! } });
    return { id: u.id, message: 'Пользователь создан' };
  }

  async deleteUser(me: AuthUser, id: string) {
    if (id === me.id) biz('Нельзя удалить себя');
    await this.prisma.user.delete({ where: { id } });
    return { message: 'Удалено' };
  }

  async saveContractor(id: string | null, v: { name: string; specialization: string }) {
    const r = id ? await this.prisma.contractor.update({ where: { id }, data: v }) : await this.prisma.contractor.create({ data: v });
    return { id: r.id, message: 'Сохранено' };
  }

  async deleteContractor(id: string) {
    const used = (await this.prisma.executionContractor.count({ where: { contractorId: id } })) + (await this.prisma.user.count({ where: { contractorId: id } }));
    if (used) biz('Подрядчик назначен на выполнения или у него есть пользователи');
    await this.prisma.contractor.delete({ where: { id } });
    return { message: 'Удалено' };
  }

  async saveClient(id: string | null, v: { name: string }) {
    const r = id ? await this.prisma.client.update({ where: { id }, data: v }) : await this.prisma.client.create({ data: v });
    return { id: r.id, message: 'Сохранено' };
  }

  async deleteClient(id: string) {
    if (await this.prisma.siteObject.count({ where: { clientId: id } })) biz('У заказчика есть объекты');
    await this.prisma.client.delete({ where: { id } });
    return { message: 'Удалено' };
  }

  /**
   * Вид разметки. Смена коэффициентов пересчитывает строки всех форм и актов,
   * которые ещё не согласованы. Согласованные и архивные акты сохраняют снимок коэффициентов.
   */
  async saveMarkingType(id: string | null, v: { code: string; name: string; widthM: number; fillRatio: number }) {
    if (v.fillRatio > 1) biz('Доля заполнения не может быть больше 1');
    return this.prisma.$transaction(async (tx) => {
      if (!id) {
        const max = await tx.markingType.aggregate({ _max: { sortOrder: true } });
        const r = await tx.markingType.create({ data: { ...v, sortOrder: (max._max.sortOrder ?? 0) + 1 } });
        return { id: r.id, message: 'Сохранено' };
      }
      await tx.markingType.update({ where: { id }, data: v });
      const notFinal: Prisma.ExecutionWhereInput = { OR: [{ act: { is: null } }, { act: { status: { notIn: ['APPROVED', 'ARCHIVED'] } } }] };
      const formLines = await tx.formLine.findMany({ where: { markingTypeId: id, form: { execution: notFinal } }, select: { id: true, linearM: true, formId: true } });
      for (const l of formLines) {
        await tx.formLine.update({ where: { id: l.id }, data: { widthM: v.widthM, fillRatio: v.fillRatio, areaM2: r2(n(l.linearM) * v.widthM * v.fillRatio) } });
      }
      for (const formId of new Set(formLines.map((l) => l.formId))) {
        const s = await tx.formLine.aggregate({ where: { formId }, _sum: { areaM2: true } });
        await tx.contractorForm.update({ where: { id: formId }, data: { totalM2: r2(n(s._sum.areaM2)) } });
      }
      const rowLines = await tx.actRowLine.findMany({
        where: { markingTypeId: id, row: { act: { status: { notIn: ['APPROVED', 'ARCHIVED'] } } } }, select: { id: true, linearM: true, rowId: true },
      });
      for (const l of rowLines) {
        await tx.actRowLine.update({ where: { id: l.id }, data: { widthM: v.widthM, fillRatio: v.fillRatio, areaM2: r2(n(l.linearM) * v.widthM * v.fillRatio) } });
      }
      for (const rowId of new Set(rowLines.map((l) => l.rowId))) {
        const s = await tx.actRowLine.aggregate({ where: { rowId }, _sum: { areaM2: true } });
        const row = await tx.actRow.update({ where: { id: rowId }, data: { totalM2: r2(n(s._sum.areaM2)) } });
        const t = await tx.actRow.aggregate({ where: { actId: row.actId }, _sum: { totalM2: true } });
        await tx.act.update({ where: { id: row.actId }, data: { totalM2: r2(n(t._sum.totalM2)) } });
      }
      return { id, message: formLines.length ? `Сохранено. Пересчитано строк форм: ${formLines.length}` : 'Сохранено' };
    });
  }

  async deleteMarkingType(id: string) {
    const used = (await this.prisma.formLine.count({ where: { markingTypeId: id } })) + (await this.prisma.actRowLine.count({ where: { markingTypeId: id } }));
    if (used) biz('Вид разметки используется в формах подрядчиков');
    await this.prisma.markingType.delete({ where: { id } });
    return { message: 'Удалено' };
  }

  async saveSettings(v: { remindFirstDays: number; remindSecondDays: number; toleranceM2: number }) {
    if (v.remindSecondDays <= v.remindFirstDays) biz('Второе напоминание должно быть позже первого');
    await this.prisma.settings.upsert({ where: { id: 1 }, update: v, create: { id: 1, ...v } });
    return { message: 'Настройки сохранены' };
  }
}
