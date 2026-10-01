import { Injectable } from '@nestjs/common';
import { HistoryEntry as DbHistory, Prisma, StoredFile } from '@prisma/client';
import { AuthUser, isStaff } from '../common/auth';
import { PrismaService } from '../prisma.service';
import { n } from '../workflow/helpers';

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Снимок данных, видимых пользователю, в формате фронтенда (тот же Data, что в прототипе).
 * Права применяются здесь, на сервере:
 *  • подрядчик — только объекты, где он назначен; формы партнёров — только цифры (без файлов и истории);
 *  • заказчик — только объекты своей организации; комментарии ГП скрыты;
 *  • уведомления — только свои, последние 1000.
 * Для 30 пользователей и сотен объектов этого достаточно; при росте — пагинация по разделам.
 */
@Injectable()
export class StateService {
  constructor(private prisma: PrismaService) {}

  async snapshot(u: AuthUser) {
    const staff = isStaff(u.role);
    const objWhere: Prisma.SiteObjectWhereInput = staff ? {} : u.role === 'CLIENT'
      ? { clientId: u.clientId ?? '' }
      : { executions: { some: { contractors: { some: { contractorId: u.contractorId ?? '' } } } } };
    const exWhere: Prisma.ExecutionWhereInput = u.role === 'CONTRACTOR'
      ? { contractors: { some: { contractorId: u.contractorId ?? '' } } }
      : { object: objWhere };

    const [users, contractors, clients, markingTypes, objects, executions, settings, chat, notifications] = await Promise.all([
      this.prisma.user.findMany({ orderBy: { createdAt: 'asc' } }),
      this.prisma.contractor.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.client.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.markingType.findMany({ orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] }),
      this.prisma.siteObject.findMany({ where: objWhere, orderBy: { excelRowNumber: 'asc' } }),
      this.prisma.execution.findMany({
        where: exWhere,
        include: {
          contractors: { orderBy: { assignedAt: 'asc' } },
          history: { orderBy: { createdAt: 'asc' } },
          titleChanges: { where: { duringApproval: true, resolvedAt: null }, orderBy: { createdAt: 'desc' }, take: 1 },
          forms: { include: { lines: true, schemeFile: true, photoFile: true, history: { orderBy: { createdAt: 'asc' } } } },
          act: { include: { rows: { include: { lines: true, schemeFile: true, photoFile: true } }, history: { orderBy: { createdAt: 'asc' } } } },
        },
      }),
      this.prisma.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } }),
      this.prisma.chatMessage.findMany({ where: { object: objWhere }, orderBy: { createdAt: 'asc' } }),
      this.prisma.notification.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'desc' }, take: 1000 }),
    ]);

    const file = (f: StoredFile | null) => (f ? { id: f.id, name: f.originalName, size: Number(f.size), uploadedAt: iso(f.createdAt)!, uploadedBy: f.uploadedById || '' } : null);
    const history = (list: DbHistory[]) => list
      .filter((h) => !(u.role === 'CONTRACTOR' && h.visibleToContractorId && h.visibleToContractorId !== u.contractorId))
      .map((h) => ({
        at: iso(h.createdAt)!, userId: h.userId || 'system', action: h.action,
        comment: u.role === 'CLIENT' && h.hiddenFromClient ? undefined : h.comment || undefined,
        hiddenFromClient: h.hiddenFromClient || undefined, highlight: h.highlight || undefined,
      }));
    const lines = (ls: { markingTypeId: string; linearM: Prisma.Decimal; areaM2?: Prisma.Decimal }[], fixed = false) =>
      ls.map((l) => ({ markingTypeId: l.markingTypeId, linearM: n(l.linearM), ...(fixed ? { m2: n(l.areaM2) } : {}) }));
    /** Чужие файлы подрядчику не показываем (п. 2 ТЗ: «только цифры, без файлов»). */
    const own = (contractorId: string) => u.role !== 'CONTRACTOR' || u.contractorId === contractorId;

    return {
      users: users.map((x) => ({
        id: x.id, login: u.role === 'GC' || x.id === u.id ? x.login : '', password: '', name: x.name, role: x.role,
        contractorId: x.contractorId, clientId: x.clientId,
        telegramChatId: x.telegramChatId && (staff || x.id === u.id) ? 'linked' : null,
        passwordChangedAt: iso(x.passwordChangedAt), active: x.active,
      })),
      contractors: contractors.map(({ id, name, specialization }) => ({ id, name, specialization })),
      clients: clients.map(({ id, name }) => ({ id, name })),
      markingTypes: markingTypes.map((m) => ({ id: m.id, code: m.code, name: m.name, widthM: n(m.widthM), fillRatio: n(m.fillRatio) })),
      objects: objects.map((o) => ({
        id: o.id, excelRowNumber: o.excelRowNumber ?? 0, name: o.name, address: o.address, district: o.district,
        clientId: o.clientId, titleM2: n(o.titleM2), createdAt: iso(o.createdAt),
      })),
      executions: executions.map((e) => {
        const tc = e.titleChanges[0];
        return {
          id: e.id, objectId: e.objectId, number: e.number, name: e.name, periodFrom: day(e.periodFrom), periodTo: day(e.periodTo),
          titleM2: n(e.titleM2), contractorIds: e.contractors.map((c) => c.contractorId),
          lastActivityAt: iso(e.lastActivityAt), reminderLevel: e.reminderLevel, history: history(e.history),
          titleChange: tc ? { from: n(tc.fromM2), to: n(tc.toM2), at: iso(tc.createdAt), userId: tc.userId || 'system', reason: tc.reason } : null,
        };
      }),
      forms: executions.flatMap((e) => e.forms.map((f) => ({
        id: f.id, executionId: f.executionId, contractorId: f.contractorId, lines: lines(f.lines),
        schemeFile: own(f.contractorId) ? file(f.schemeFile) : null, photoFile: own(f.contractorId) ? file(f.photoFile) : null,
        status: f.status, autoZero: f.autoZero, updatedAt: iso(f.updatedAt), history: own(f.contractorId) ? history(f.history) : [],
      }))),
      acts: executions.filter((e) => e.act).map((e) => {
        const a = e.act!;
        return {
          id: a.id, number: a.number, executionId: a.executionId, objectId: a.objectId, status: a.status, round: a.round,
          createdAt: iso(a.createdAt), updatedAt: iso(a.updatedAt),
          rows: e.contractors.map((c) => a.rows.find((r) => r.contractorId === c.contractorId)).filter(Boolean).map((r) => ({
            contractorId: r!.contractorId, lines: lines(r!.lines, a.status === 'APPROVED' || a.status === 'ARCHIVED'), autoZero: r!.autoZero,
            schemeFile: own(r!.contractorId) ? file(r!.schemeFile) : null, photoFile: own(r!.contractorId) ? file(r!.photoFile) : null,
          })),
          history: history(a.history), wordDownloadedAt: iso(a.wordGeneratedAt), archivedAt: iso(a.archivedAt),
        };
      }),
      chat: chat.map((m) => ({ id: m.id, objectId: m.objectId, userId: m.userId || 'system', text: m.text, at: iso(m.createdAt) })),
      notifications: notifications.map((x) => ({
        id: x.id, userId: x.userId, text: x.text, at: iso(x.createdAt), read: !!x.readAt, link: x.link || undefined,
        telegram: x.telegram !== 'NONE', kind: x.kind.toLowerCase(), objectId: x.objectId, executionId: x.executionId,
      })),
      settings: { remindFirstDays: settings.remindFirstDays, remindSecondDays: settings.remindSecondDays, toleranceM2: n(settings.toleranceM2) },
      clockOffsetDays: 0,
      actCounter: settings.actCounter,
      serverTime: new Date().toISOString(),
    };
  }
}
