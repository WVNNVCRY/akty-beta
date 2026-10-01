import type { Data, Execution, FileRef } from './types';
import { DAY } from './logic';
import {
  archiveAct, changeTitle, clientApproveForm, clientRejectForm, downloadWordLog, gcApproveAct, nowIso, saveForm, sendChat,
  submitForm, uid,
} from './engine';

/** Начальные данные демо-режима. withObjects=true — набор примеров объектов (для ручных проверок/разработки). */
export function buildSeed(withObjects = false): Data {
  const iso = new Date().toISOString();
  const d: Data = {
    users: [], contractors: [], clients: [], markingTypes: [], objects: [], executions: [], forms: [],
    acts: [], chat: [], notifications: [],
    settings: { remindFirstDays: 2, remindSecondDays: 5, toleranceM2: 0 },
    clockOffsetDays: 0, actCounter: 0,
  };

  // --- Справочники ---
  const mt = (code: string, name: string, widthM: number, fillRatio: number) => {
    const m = { id: uid(), code, name, widthM, fillRatio };
    d.markingTypes.push(m);
    return m.id;
  };
  const T: Record<string, string> = {
    '1.1': mt('1.1', 'Сплошная линия', 0.1, 1),
    '1.2': mt('1.2', 'Краевая сплошная линия', 0.2, 1),
    '1.3': mt('1.3', 'Двойная сплошная (2×0,10)', 0.2, 1),
    '1.5': mt('1.5', 'Прерывистая 1:3', 0.1, 0.25),
    '1.6': mt('1.6', 'Линия приближения 3:1', 0.1, 0.75),
    '1.7': mt('1.7', 'Прерывистая 1:1 (на перекрёстках)', 0.1, 0.5),
    '1.12': mt('1.12', 'Стоп-линия', 0.4, 1),
    '1.14.1': mt('1.14.1', 'Пешеходный переход «зебра»', 0.4, 1),
  };

  const c = (name: string, specialization: string) => {
    const x = { id: uid(), name, specialization };
    d.contractors.push(x);
    return x.id;
  };
  const MECH = c('ООО «Механика-Дор»', 'Машинная разметка');
  const HAND = c('ИП Соколов (ручная разметка)', 'Ручная разметка');
  const THERMO = c('ООО «ТермоЛиния»', 'Машинная разметка');

  const cl = (name: string) => {
    const x = { id: uid(), name };
    d.clients.push(x);
    return x.id;
  };
  const CL1 = cl('ГБУ «Автомобильные дороги ЦАО»');
  const CL2 = cl('ГБУ «Автомобильные дороги САО»');

  const user = (login: string, name: string, role: any, extra: any = {}) => {
    const u = { id: uid(), login, password: '123', name, role, passwordChangedAt: iso, active: true, telegramChatId: null, ...extra };
    d.users.push(u);
    return u.id;
  };
  const U = {
    gc: user('gc', 'Иванов И. И. (ГП)', 'GC', { telegramChatId: '100001' }),
    manager: user('manager', 'Петрова А. С. (менеджер)', 'MANAGER'),
    mech: user('mech', 'Кузнецов Д. (Механика-Дор)', 'CONTRACTOR', { contractorId: MECH, telegramChatId: '100002' }),
    hand: user('hand', 'Соколов В. (ИП Соколов)', 'CONTRACTOR', { contractorId: HAND }),
    thermo: user('thermo', 'Орлов П. (ТермоЛиния)', 'CONTRACTOR', { contractorId: THERMO }),
    client: user('client', 'Смирнова Е. (ГБУ АД ЦАО)', 'CLIENT', { clientId: CL1 }),
    client2: user('client2', 'Волков Н. (ГБУ АД САО)', 'CLIENT', { clientId: CL2 }),
  };

  // Пустой старт: справочники, организации и пользователи без объектов
  if (!withObjects) return d;

  // --- Объекты и выполнения ---
  const obj = (n: number, name: string, address: string, district: string, clientId: string, titleM2: number) => {
    const o = { id: uid(), excelRowNumber: n, name, address, district, clientId, titleM2, createdAt: nowIso(d) };
    d.objects.push(o);
    return o.id;
  };
  const ex = (objectId: string, number: number, titleM2: number, contractorIds: string[], from: string, to: string): Execution => {
    const e: Execution = {
      id: uid(), objectId, number, name: `Выполнение №${number}`, periodFrom: from, periodTo: to, titleM2, contractorIds,
      lastActivityAt: nowIso(d), reminderLevel: 0, titleChange: null,
      history: [{ at: nowIso(d), userId: U.gc, action: `Выполнение создано, объём ${titleM2} м²` }],
    };
    d.executions.push(e);
    return e;
  };

  const demoFile = (name: string, by: string): FileRef => ({ id: 'demo-' + uid(), name, size: 1024, uploadedAt: nowIso(d), uploadedBy: by });
  const fill = (userId: string, e: Execution, values: Record<string, number>, submit = true) => {
    const lines = Object.entries(values).map(([code, linearM]) => ({ markingTypeId: T[code], linearM }));
    const f = saveForm(d, userId, e.id, {
      lines, schemeFile: demoFile(`Схема_${e.name}.pdf`, userId), photoFile: demoFile(`Фото_${e.name}.pdf`, userId),
    });
    if (submit) submitForm(d, userId, f.id);
    return f;
  };
  const formOf = (e: Execution, cid: string) => d.forms.find((f) => f.executionId === e.id && f.contractorId === cid)!;
  const actOfEx = (e: Execution) => d.acts.find((a) => a.executionId === e.id)!;
  const at = (daysAgo: number) => (d.clockOffsetDays = -daysAgo);

  // 1. Свежий объект — ничего не заполнено. Титул 345 м²
  at(12);
  const o1 = obj(1, 'Тверская ул., участок 1', 'ул. Тверская, д. 1–25', 'ЦАО', CL1, 800);
  ex(o1, 1, 345, [MECH, HAND], '2026-09-01', '2026-09-30');

  // 2. Механика подала часть, у Ручки черновик — ожидание партнёра, висит 3 дня. Титул 386
  const o2 = obj(2, 'Ленинградский пр-т, дублёр', 'Ленинградский пр-т, д. 30–64', 'САО', CL2, 386);
  const e2 = ex(o2, 1, 386, [MECH, HAND], '2026-09-01', '2026-09-30');
  at(3);
  fill(U.mech, e2, { '1.1': 2000, '1.2': 450 }); // 290 м²
  fill(U.hand, e2, { '1.14.1': 180 }, false); // черновик 72 из 96

  // 3. Обе формы сошлись — у заказчика на проверке. Титул 374
  at(10);
  const o3 = obj(3, 'Садовое кольцо, внутр. сторона', 'Садовая-Кудринская ул.', 'ЦАО', CL1, 600);
  const e3 = ex(o3, 1, 374, [MECH, HAND], '2026-09-05', '2026-09-25');
  at(1);
  fill(U.mech, e3, { '1.1': 1500, '1.3': 400 }); // 230
  fill(U.hand, e3, { '1.12': 60, '1.14.1': 300 }); // 144
  sendChat(d, U.hand, o3, 'Зебру у д. 12 нанесли повторно после ремонта покрытия, фото приложил.');
  sendChat(d, U.client, o3, 'Посмотрю сегодня.');

  // 4. Заказчик одобрил обе формы — акт у ГП. Титул 504
  at(9);
  const o4 = obj(4, 'Варшавское ш., км 3–5', 'Варшавское ш., д. 10–48', 'ЮАО', CL1, 504);
  const e4 = ex(o4, 1, 504, [MECH, HAND], '2026-08-20', '2026-09-15');
  at(6);
  fill(U.mech, e4, { '1.1': 3000, '1.5': 2400 }); // 360
  fill(U.hand, e4, { '1.14.1': 360 }); // 144
  at(4);
  clientApproveForm(d, U.client, formOf(e4, MECH).id);
  clientApproveForm(d, U.client, formOf(e4, HAND).id);

  // 5. Выполнение 1 — согласовано ГП; выполнение 2 — заказчик отклонил форму Ручки
  at(20);
  const o5 = obj(5, 'Профсоюзная ул.', 'ул. Профсоюзная, д. 2–40', 'ЦАО', CL1, 300);
  const e5a = ex(o5, 1, 160, [MECH, HAND], '2026-08-01', '2026-08-31');
  const e5b = ex(o5, 2, 60, [MECH, HAND], '2026-09-01', '2026-09-30');
  at(15);
  fill(U.mech, e5a, { '1.1': 1000 }); // 100
  fill(U.hand, e5a, { '1.14.1': 150 }); // 60
  clientApproveForm(d, U.client, formOf(e5a, MECH).id);
  clientApproveForm(d, U.client, formOf(e5a, HAND).id);
  at(12);
  gcApproveAct(d, U.gc, actOfEx(e5a).id);
  at(5);
  fill(U.mech, e5b, { '1.2': 250 }); // 50
  fill(U.hand, e5b, { '1.7': 200 }); // 10
  clientApproveForm(d, U.client, formOf(e5b, MECH).id);
  at(2);
  clientRejectForm(d, U.client, formOf(e5b, HAND).id, 'На фото по 1.7 не видно привязки к перекрёстку, переснимите с ориентиром.');

  // 6. Архив — три подрядчика на одном выполнении. Титул 630
  at(40);
  const o6 = obj(6, 'Кутузовский пр-т', 'Кутузовский пр-т, д. 1–33', 'ЗАО', CL1, 630);
  const e6 = ex(o6, 1, 630, [MECH, THERMO, HAND], '2026-07-01', '2026-07-31');
  at(35);
  fill(U.mech, e6, { '1.1': 2500, '1.6': 400 }); // 280
  fill(U.thermo, e6, { '1.1': 1500 }); // 150
  fill(U.hand, e6, { '1.14.1': 500 }); // 200
  [MECH, THERMO, HAND].forEach((cid) => clientApproveForm(d, U.client, formOf(e6, cid).id));
  at(32);
  gcApproveAct(d, U.gc, actOfEx(e6).id);
  at(30);
  downloadWordLog(d, U.gc, actOfEx(e6).id);
  archiveAct(d, U.gc, actOfEx(e6).id);

  // 7. Автоотправка нулей: Механика выбрала весь объём, ТермоЛиния и Ручка — автоматически с нулями
  at(6);
  const o7 = obj(7, 'Дмитровское ш.', 'Дмитровское ш., д. 50–120', 'САО', CL2, 500);
  const e7 = ex(o7, 1, 260, [MECH, THERMO, HAND], '2026-09-15', '2026-10-15');
  at(1);
  fill(U.mech, e7, { '1.1': 2200, '1.5': 1600 }); // 220 + 40 = 260

  // 8. Изменение титула после одобрения заказчиком — формы вернулись на пересчёт
  at(14);
  const o8 = obj(8, 'Большая Никитская ул.', 'ул. Большая Никитская, д. 5–45', 'ЦАО', CL1, 350);
  const e8 = ex(o8, 1, 250, [MECH, HAND], '2026-09-01', '2026-09-20');
  at(8);
  fill(U.mech, e8, { '1.1': 1700 }); // 170
  fill(U.hand, e8, { '1.14.1': 200 }); // 80
  at(6);
  clientApproveForm(d, U.client, formOf(e8, MECH).id);
  clientApproveForm(d, U.client, formOf(e8, HAND).id);
  at(3);
  changeTitle(d, U.gc, e8, 280, 'Уточнён титульный список: добавлен участок у д. 45 (+30 м²)');

  // 9. Свежий объект, 3 подрядчика
  at(2);
  const o9 = obj(9, 'Новослободская ул.', 'ул. Новослободская, д. 3–50', 'ЦАО', CL1, 900);
  ex(o9, 1, 300, [MECH, THERMO, HAND], '2026-09-20', '2026-10-20');

  d.clockOffsetDays = 0;
  d.notifications.forEach((n) => (n.read = Date.now() - new Date(n.at).getTime() > 5 * DAY));
  return d;
}
