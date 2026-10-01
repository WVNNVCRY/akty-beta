import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service';
import { actFinal, balance, exInclude, exLabel, fmt, getSettings, shortage, contractorIdsOf } from '../workflow/helpers';
import { NotifyService } from './notify.service';

/**
 * Напоминания 2/5 дней (сроки — в настройках). Подрядчикам — по каждому выполнению,
 * ГП и менеджерам — одна сводка за проверку, чтобы при сотнях объектов не засыпать ленту.
 * Запускается каждый час и вручную из админки.
 */
@Injectable()
export class RemindersService {
  private log = new Logger('Reminders');
  constructor(private prisma: PrismaService, private notifier: NotifyService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async cron() {
    const r = await this.run();
    if (r.first + r.second) this.log.log(`напоминаний: 2 дн. — ${r.first}, 5 дн. — ${r.second}`);
  }

  async run(now = new Date()) {
    const s = await getSettings(this.prisma);
    const d1 = s.remindFirstDays, d2 = s.remindSecondDays;
    const since = new Date(now.getTime() - d1 * 86_400_000);
    // Кандидаты: давно без движения, ещё не напомнили на максимальном уровне, есть формы или акт
    const list = await this.prisma.execution.findMany({
      where: { lastActivityAt: { lte: since }, reminderLevel: { lt: 2 }, OR: [{ forms: { some: {} } }, { act: { isNot: null } }] },
      include: exInclude,
    });
    const stale: string[] = [];
    let first = 0, second = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const ex of list) {
        if (actFinal(ex.act?.status)) continue;
        const idle = (now.getTime() - ex.lastActivityAt.getTime()) / 86_400_000;
        const { label, link, rel } = exLabel(ex);
        const users = await this.notifier.contractorUserIds(tx, contractorIdsOf(ex));
        if (idle >= d2 && ex.reminderLevel < 2) {
          await tx.execution.update({ where: { id: ex.id }, data: { reminderLevel: 2 } });
          await this.notifier.notify(tx, users, `Акт висит ${d2} дн., требуется вмешательство: ${label}`, link,
            { kind: 'REMINDER', ...rel, dedupeKey: `r2:${ex.id}:${ex.lastActivityAt.toISOString()}` });
          stale.push(label);
          second++;
        } else if (idle >= d1 && ex.reminderLevel < 1) {
          await tx.execution.update({ where: { id: ex.id }, data: { reminderLevel: 1 } });
          const short = shortage(balance(ex));
          if (short > 0) {
            await this.notifier.notify(tx, users, `Акт висит ${d1} дн., недостача: ${fmt(short)} м² (${label})`, link,
              { kind: 'REMINDER', ...rel, dedupeKey: `r1:${ex.id}:${ex.lastActivityAt.toISOString()}` });
          }
          first++;
        }
      }
      if (stale.length) {
        const text = stale.slice(0, 5).join('; ') + (stale.length > 5 ? ` и ещё ${stale.length - 5}` : '');
        await this.notifier.notify(tx, await this.notifier.staffIds(tx), `Сводка: ${stale.length} выполн. без решения ≥ ${d2} дн. — ${text}`, '/objects', { kind: 'REMINDER' });
      }
    }, { timeout: 60_000 });
    return { first, second };
  }
}
