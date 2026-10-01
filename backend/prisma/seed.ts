/**
 * Тестовые данные (этап 1 ТЗ) — те же справочники, пользователи и объекты,
 * что и в бета-прототипе. Запуск: npx prisma db seed  (или npx tsx prisma/seed.ts)
 *
 * Пароль у всех демо-пользователей: 123
 * Хэш — scrypt из node:crypto (без внешних зависимостей), формат scrypt$<salt>$<hash>.
 * В NestJS проверка: crypto.scryptSync(password, salt, 64) === hash (timingSafeEqual).
 */
import { PrismaClient, Prisma, UserRole, FormStatus, ActStatus, NotificationKind, FileKind } from '@prisma/client';
import { randomBytes, scryptSync } from 'node:crypto';

const prisma = new PrismaClient();
const D = (v: number | string) => new Prisma.Decimal(v);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString('hex')}`;
}

async function main() {
  // Защита: seed ПОЛНОСТЬЮ стирает базу. На сервере (NODE_ENV=production) — только с SEED_RESET=1.
  if (process.env.NODE_ENV === 'production' && process.env.SEED_RESET !== '1') {
    throw new Error('seed стирает все данные. На сервере запустите явно: SEED_RESET=1 npx tsx prisma/seed.ts');
  }
  // Порядок важен из-за внешних ключей
  await prisma.$transaction([
    prisma.notification.deleteMany(),
    prisma.chatReadMark.deleteMany(),
    prisma.chatMessage.deleteMany(),
    prisma.historyEntry.deleteMany(),
    prisma.importRow.deleteMany(),
    prisma.importLog.deleteMany(),
    prisma.act.deleteMany(),
    prisma.contractorForm.deleteMany(),
    prisma.titleChange.deleteMany(),
    prisma.execution.deleteMany(),
    prisma.siteObject.deleteMany(),
    prisma.storedFile.deleteMany(),
    prisma.telegramLinkToken.deleteMany(),
    prisma.user.deleteMany(),
    prisma.contractor.deleteMany(),
    prisma.client.deleteMany(),
    prisma.markingType.deleteMany(),
    prisma.settings.deleteMany(),
  ]);

  await prisma.settings.create({ data: { id: 1, remindFirstDays: 2, remindSecondDays: 5, toleranceM2: D(0) } });

  // --- Виды разметки: площадь = пм × ширина × доля заполнения ---
  const mtDefs: [string, string, number, number][] = [
    ['1.1', 'Сплошная линия', 0.1, 1],
    ['1.2', 'Краевая сплошная линия', 0.2, 1],
    ['1.3', 'Двойная сплошная (2×0,10)', 0.2, 1],
    ['1.5', 'Прерывистая 1:3', 0.1, 0.25],
    ['1.6', 'Линия приближения 3:1', 0.1, 0.75],
    ['1.7', 'Прерывистая 1:1 (на перекрёстках)', 0.1, 0.5],
    ['1.12', 'Стоп-линия', 0.4, 1],
    ['1.14.1', 'Пешеходный переход «зебра»', 0.4, 1],
  ];
  const MT: Record<string, { id: string; widthM: Prisma.Decimal; fillRatio: Prisma.Decimal }> = {};
  for (const [i, [code, name, w, f]] of mtDefs.entries()) {
    MT[code] = await prisma.markingType.create({
      data: { code, name, widthM: D(w), fillRatio: D(f), sortOrder: i },
      select: { id: true, widthM: true, fillRatio: true },
    });
  }

  // --- Организации ---
  const MECH = await prisma.contractor.create({ data: { name: 'ООО «Механика-Дор»', specialization: 'Механика' } });
  const HAND = await prisma.contractor.create({ data: { name: 'ИП Соколов (ручная разметка)', specialization: 'Ручка' } });
  const THERMO = await prisma.contractor.create({ data: { name: 'ООО «ТермоЛиния»', specialization: 'Механика' } });
  const CL1 = await prisma.client.create({ data: { name: 'ГБУ «Автомобильные дороги ЦАО»' } });
  const CL2 = await prisma.client.create({ data: { name: 'ГБУ «Автодороги САО»' } });

  // --- Пользователи ---
  const pwd = hashPassword('123');
  const user = (login: string, name: string, role: UserRole, extra: Partial<Prisma.UserUncheckedCreateInput> = {}) =>
    prisma.user.create({ data: { login, name, role, passwordHash: pwd, ...extra } });
  const U = {
    gc: await user('gc', 'Иванов И. И. (ГП)', 'GC', { telegramChatId: '100001', telegramLinkedAt: new Date() }),
    manager: await user('manager', 'Петрова А. С. (менеджер)', 'MANAGER'),
    mech: await user('mech', 'Кузнецов Д. (Механика-Дор)', 'CONTRACTOR', { contractorId: MECH.id, telegramChatId: '100002', telegramLinkedAt: new Date() }),
    hand: await user('hand', 'Соколов В. (Ручка)', 'CONTRACTOR', { contractorId: HAND.id }),
    thermo: await user('thermo', 'Орлов П. (ТермоЛиния)', 'CONTRACTOR', { contractorId: THERMO.id }),
    client: await user('client', 'Смирнова Е. (ГБУ АД ЦАО)', 'CLIENT', { clientId: CL1.id }),
    client2: await user('client2', 'Волков Н. (ГБУ АД САО)', 'CLIENT', { clientId: CL2.id }),
  };
  const userOfContractor: Record<string, string> = { [MECH.id]: U.mech.id, [HAND.id]: U.hand.id, [THERMO.id]: U.thermo.id };

  // --- Хелперы ---
  const obj = (n: number, name: string, address: string, district: string, clientId: string, titleM2: number, ago: number) =>
    prisma.siteObject.create({
      data: { excelRowNumber: n, name, address, district, clientId, titleM2: D(titleM2), createdById: U.gc.id, createdAt: daysAgo(ago) },
    });

  const ex = (objectId: string, number: number, titleM2: number, contractorIds: string[], from: string, to: string, ago: number) =>
    prisma.execution.create({
      data: {
        objectId, number, name: `Выполнение №${number}`, titleM2: D(titleM2),
        periodFrom: new Date(from), periodTo: new Date(to),
        createdById: U.gc.id, createdAt: daysAgo(ago), lastActivityAt: daysAgo(ago),
        contractors: { create: contractorIds.map((contractorId) => ({ contractorId })) },
        history: { create: { userId: U.gc.id, action: 'EXECUTION_CREATED', comment: `Объём ${titleM2} м²`, createdAt: daysAgo(ago) } },
      },
    });

  const pdf = (kind: FileKind, name: string, uploadedById: string) =>
    prisma.storedFile.create({
      data: { kind, bucket: 'akty-dev', key: `forms/${randomBytes(8).toString('hex')}/${name}`, originalName: name, mimeType: 'application/pdf', size: BigInt(1024), uploadedById },
    });

  const lineData = (values: Record<string, number>) =>
    Object.entries(values).map(([code, linearM]) => {
      const t = MT[code];
      return { markingTypeId: t.id, linearM: D(linearM), widthM: t.widthM, fillRatio: t.fillRatio, areaM2: D(linearM).mul(t.widthM).mul(t.fillRatio) };
    });
  const sum = (lines: { areaM2: Prisma.Decimal }[]) => lines.reduce((s, l) => s.add(l.areaM2), D(0));

  /** Форма подрядчика с файлами и строками. */
  const form = async (executionId: string, contractorId: string, values: Record<string, number>, status: FormStatus, ago: number, autoZero = false) => {
    const by = userOfContractor[contractorId];
    const lines = lineData(values);
    const scheme = autoZero ? null : await pdf('SCHEME', 'Схема.pdf', by);
    const photo = autoZero ? null : await pdf('PHOTO', 'Фото.pdf', by);
    return prisma.contractorForm.create({
      data: {
        executionId, contractorId, status, autoZero, totalM2: sum(lines),
        schemeFileId: scheme?.id, photoFileId: photo?.id,
        submittedAt: status === 'DRAFT' ? null : daysAgo(ago), updatedAt: daysAgo(ago),
        lines: { create: lines },
        history: { create: { userId: autoZero ? null : by, action: autoZero ? 'FORM_AUTO_ZERO' : status === 'DRAFT' ? 'FORM_SAVED' : 'FORM_SUBMITTED', createdAt: daysAgo(ago) } },
      },
      include: { lines: true },
    });
  };

  let actCounter = 0;
  /** Акт = снимок форм выполнения (файлы копируются ссылками на StoredFile). */
  const act = async (executionId: string, objectId: string, status: ActStatus, ago: number, extra: Partial<Prisma.ActUncheckedCreateInput> = {}) => {
    const forms = await prisma.contractorForm.findMany({ where: { executionId }, include: { lines: true } });
    actCounter += 1;
    return prisma.act.create({
      data: {
        number: `АСР-${String(actCounter).padStart(4, '0')}`, executionId, objectId, status,
        totalM2: forms.reduce((s, f) => s.add(f.totalM2), D(0)), createdAt: daysAgo(ago), ...extra,
        rows: {
          create: forms.map((f) => ({
            contractorId: f.contractorId, autoZero: f.autoZero, totalM2: f.totalM2,
            schemeFileId: f.schemeFileId, photoFileId: f.photoFileId,
            lines: { create: f.lines.map(({ markingTypeId, linearM, widthM, fillRatio, areaM2 }) => ({ markingTypeId, linearM, widthM, fillRatio, areaM2 })) },
          })),
        },
        history: { create: { action: 'ACT_CREATED', comment: 'Сумма форм совпала с титулом, акт направлен заказчику', createdAt: daysAgo(ago) } },
      },
    });
  };

  const notify = (userId: string, kind: NotificationKind, text: string, ago: number, rel: { objectId?: string; executionId?: string; actId?: string } = {}, read = false) =>
    prisma.notification.create({
      data: { userId, kind, text, createdAt: daysAgo(ago), readAt: read ? daysAgo(ago) : null, telegram: kind === 'INFO' ? 'NONE' : 'SENT', ...rel },
    });

  // --- Объекты (объёмы как в прототипе) ---
  // 1. Свежий объект — ничего не заполнено
  const o1 = await obj(1, 'Тверская ул., участок 1', 'ул. Тверская, д. 1–25', 'ЦАО', CL1.id, 800, 12);
  await ex(o1.id, 1, 345, [MECH.id, HAND.id], '2026-09-01', '2026-09-30', 12);

  // 2. Механика подала 290 м², у Ручки черновик — ожидание партнёра
  const o2 = await obj(2, 'Ленинградский пр-т, дублёр', 'Ленинградский пр-т, д. 30–64', 'САО', CL2.id, 386, 12);
  const e2 = await ex(o2.id, 1, 386, [MECH.id, HAND.id], '2026-09-01', '2026-09-30', 12);
  await form(e2.id, MECH.id, { '1.1': 2000, '1.2': 450 }, 'WAITING_PARTNER', 3);
  await form(e2.id, HAND.id, { '1.14.1': 180 }, 'DRAFT', 3);
  await notify(U.hand.id, 'REMINDER', 'Объект №2: форма не отправлена 3 дня, недостача 96 м²', 1, { objectId: o2.id, executionId: e2.id });

  // 3. Обе формы сошлись — акт у заказчика
  const o3 = await obj(3, 'Садовое кольцо, внутр. сторона', 'Садовая-Кудринская ул.', 'ЦАО', CL1.id, 600, 10);
  const e3 = await ex(o3.id, 1, 374, [MECH.id, HAND.id], '2026-09-05', '2026-09-25', 10);
  await form(e3.id, MECH.id, { '1.1': 1500, '1.3': 400 }, 'ON_CHECK_CLIENT', 1);
  await form(e3.id, HAND.id, { '1.12': 60, '1.14.1': 300 }, 'ON_CHECK_CLIENT', 1);
  const a3 = await act(e3.id, o3.id, 'ON_CHECK_CLIENT', 1);
  await notify(U.client.id, 'ACTION', `Акт ${a3.number} ждёт вашего решения`, 1, { objectId: o3.id, executionId: e3.id, actId: a3.id });
  await prisma.chatMessage.createMany({
    data: [
      { objectId: o3.id, userId: U.hand.id, text: 'Зебру у д. 12 нанесли повторно после ремонта покрытия, фото приложил.', createdAt: daysAgo(1) },
      { objectId: o3.id, userId: U.client.id, text: 'Посмотрю сегодня.', createdAt: daysAgo(0.9) },
    ],
  });

  // 4. Заказчик одобрил обе формы — акт у ГП
  const o4 = await obj(4, 'Варшавское ш., км 3–5', 'Варшавское ш., д. 10–48', 'ЮАО', CL1.id, 504, 9);
  const e4 = await ex(o4.id, 1, 504, [MECH.id, HAND.id], '2026-08-20', '2026-09-15', 9);
  await form(e4.id, MECH.id, { '1.1': 3000, '1.5': 2400 }, 'APPROVED_BY_CLIENT', 4);
  await form(e4.id, HAND.id, { '1.14.1': 360 }, 'APPROVED_BY_CLIENT', 4);
  const a4 = await act(e4.id, o4.id, 'ON_CHECK_GC', 6);
  await notify(U.gc.id, 'ACTION', `Акт ${a4.number}: все формы одобрены заказчиком — финальная проверка`, 4, { objectId: o4.id, executionId: e4.id, actId: a4.id });

  // 5. Два выполнения: №1 согласовано, №2 — форма Ручки отклонена заказчиком
  const o5 = await obj(5, 'Профсоюзная ул.', 'ул. Профсоюзная, д. 2–40', 'ЦАО', CL1.id, 300, 20);
  const e5a = await ex(o5.id, 1, 160, [MECH.id, HAND.id], '2026-08-01', '2026-08-31', 20);
  const e5b = await ex(o5.id, 2, 60, [MECH.id, HAND.id], '2026-09-01', '2026-09-30', 20);
  await form(e5a.id, MECH.id, { '1.1': 1000 }, 'APPROVED_BY_CLIENT', 15);
  await form(e5a.id, HAND.id, { '1.14.1': 150 }, 'APPROVED_BY_CLIENT', 15);
  await act(e5a.id, o5.id, 'APPROVED', 15, { approvedAt: daysAgo(12) });
  await form(e5b.id, MECH.id, { '1.2': 250 }, 'APPROVED_BY_CLIENT', 5);
  const f5h = await form(e5b.id, HAND.id, { '1.7': 200 }, 'REJECTED_BY_CLIENT', 2);
  const a5b = await act(e5b.id, o5.id, 'IN_REVISION', 5, { round: 1 });
  await prisma.historyEntry.create({
    data: {
      formId: f5h.id, actId: a5b.id, userId: U.client.id, action: 'CLIENT_REJECTED', createdAt: daysAgo(2),
      comment: 'На фото по 1.7 не видно привязки к перекрёстку, переснимите с ориентиром.',
      visibleToContractorId: HAND.id,
    },
  });
  await notify(U.hand.id, 'ACTION', `Акт ${a5b.number}: заказчик отклонил вашу форму`, 2, { objectId: o5.id, executionId: e5b.id, actId: a5b.id });

  // 6. Архив — три подрядчика
  const o6 = await obj(6, 'Кутузовский пр-т', 'Кутузовский пр-т, д. 1–33', 'ЗАО', CL1.id, 630, 40);
  const e6 = await ex(o6.id, 1, 630, [MECH.id, THERMO.id, HAND.id], '2026-07-01', '2026-07-31', 40);
  await form(e6.id, MECH.id, { '1.1': 2500, '1.6': 400 }, 'APPROVED_BY_CLIENT', 35);
  await form(e6.id, THERMO.id, { '1.1': 1500 }, 'APPROVED_BY_CLIENT', 35);
  await form(e6.id, HAND.id, { '1.14.1': 500 }, 'APPROVED_BY_CLIENT', 35);
  const word = await prisma.storedFile.create({
    data: { kind: 'WORD_ACT', bucket: 'akty-dev', key: 'acts/ASR-word.docx', originalName: 'Акт.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: BigInt(20480), uploadedById: U.gc.id },
  });
  await act(e6.id, o6.id, 'ARCHIVED', 35, { approvedAt: daysAgo(32), archivedAt: daysAgo(30), wordFileId: word.id, wordGeneratedAt: daysAgo(30) });

  // 7. Автоотправка нулей: Механика закрыла весь объём
  const o7 = await obj(7, 'Дмитровское ш.', 'Дмитровское ш., д. 50–120', 'САО', CL2.id, 500, 6);
  const e7 = await ex(o7.id, 1, 260, [MECH.id, THERMO.id, HAND.id], '2026-09-15', '2026-10-15', 6);
  await form(e7.id, MECH.id, { '1.1': 2200, '1.5': 1600 }, 'ON_CHECK_CLIENT', 1);
  await form(e7.id, THERMO.id, {}, 'ON_CHECK_CLIENT', 1, true);
  await form(e7.id, HAND.id, {}, 'ON_CHECK_CLIENT', 1, true);
  await act(e7.id, o7.id, 'ON_CHECK_CLIENT', 1);

  // 8. Изменение титула после одобрения заказчиком (250 → 280)
  const o8 = await obj(8, 'Большая Никитская ул.', 'ул. Большая Никитская, д. 5–45', 'ЦАО', CL1.id, 350, 14);
  const e8 = await ex(o8.id, 1, 280, [MECH.id, HAND.id], '2026-09-01', '2026-09-20', 14);
  await form(e8.id, MECH.id, { '1.1': 1700 }, 'TITLE_CHANGED', 3);
  await form(e8.id, HAND.id, { '1.14.1': 200 }, 'TITLE_CHANGED', 3);
  const reason = 'Уточнён титульный список: добавлен участок у д. 45 (+30 м²)';
  await prisma.titleChange.create({ data: { executionId: e8.id, fromM2: D(250), toM2: D(280), reason, duringApproval: true, userId: U.gc.id, createdAt: daysAgo(3) } });
  await prisma.historyEntry.create({ data: { executionId: e8.id, userId: U.gc.id, action: 'TITLE_CHANGED', comment: `250 → 280 м². ${reason}`, highlight: true, meta: { from: 250, to: 280 }, createdAt: daysAgo(3) } });
  for (const uid of [U.mech.id, U.hand.id, U.client.id, U.manager.id]) {
    await notify(uid, 'IMPORTANT', 'Объект №8: титул изменён после одобрения (250 → 280 м²), нужен пересчёт', 3, { objectId: o8.id, executionId: e8.id });
  }

  // 9. Свежий объект, 3 подрядчика
  const o9 = await obj(9, 'Новослободская ул.', 'ул. Новослободская, д. 3–50', 'ЦАО', CL1.id, 900, 2);
  await ex(o9.id, 1, 300, [MECH.id, THERMO.id, HAND.id], '2026-09-20', '2026-10-20', 2);

  await prisma.settings.update({ where: { id: 1 }, data: { actCounter } });

  const counts = {
    users: await prisma.user.count(), objects: await prisma.siteObject.count(), executions: await prisma.execution.count(),
    forms: await prisma.contractorForm.count(), acts: await prisma.act.count(), notifications: await prisma.notification.count(),
  };
  console.log('Seed OK:', counts);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
