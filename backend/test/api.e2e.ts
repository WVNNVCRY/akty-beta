/**
 * Сквозной тест API на реальной БД. Запуск (сервер уже запущен, БД после seed):
 *   API=http://localhost:3000/api npx tsx test/api.e2e.ts
 */
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';

const API = process.env.API || 'http://localhost:3000/api';
const prisma = new PrismaClient();
let passed = 0;
const results: string[] = [];

async function step(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    results.push(`  ✔ ${name}`);
  } catch (e: any) {
    results.push(`  ✘ ${name}\n      ${e.message}`);
    console.log(results.join('\n'));
    throw e;
  }
}

type R = { status: number; body: any };
async function call(token: string | null, method: string, path: string, body?: unknown): Promise<R> {
  const r = await fetch(API + path, {
    method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, body: ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
}
const ok = async (p: Promise<R>) => { const r = await p; assert.ok(r.status < 300, `ожидали успех, получили ${r.status}: ${JSON.stringify(r.body?.message ?? '')}`); return r.body; };
const fail = async (p: Promise<R>, status: number, text?: RegExp) => {
  const r = await p;
  assert.equal(r.status, status, `ожидали ${status}, получили ${r.status}: ${JSON.stringify(r.body?.message ?? '')}`);
  if (text) assert.match(r.body.message, text);
  return r.body.message as string;
};
const login = async (l: string, p = '123') => (await ok(call(null, 'POST', '/auth/login', { login: l, password: p }))).token as string;

const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
async function upload(token: string, kind: 'SCHEME' | 'PHOTO', body = pdf, name = 'Схема участка.pdf') {
  const fd = new FormData();
  fd.append('kind', kind);
  fd.append('file', new Blob([body]), name);
  const r = await fetch(API + '/files', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: fd });
  return { status: r.status, body: await r.json() };
}

async function main() {
  const T: Record<string, string> = {};
  const S = async (who: string) => ok(call(T[who], 'GET', '/state'));
  const mt = Object.fromEntries((await prisma.markingType.findMany()).map((m) => [m.code, m.id]));
  const [MECH, HAND, THERMO] = await Promise.all(['ООО «Механика-Дор»', 'ИП Соколов (ручная разметка)', 'ООО «ТермоЛиния»'].map(
    async (name) => (await prisma.contractor.findUniqueOrThrow({ where: { name } })).id));
  const CL1 = (await prisma.client.findFirstOrThrow({ where: { name: { contains: 'ЦАО' } } })).id;

  console.log('Авторизация и роли');
  await step('health без токена', async () => assert.equal((await ok(call(null, 'GET', '/health'))).ok, true));
  await step('неверный пароль → 400', async () => { await fail(call(null, 'POST', '/auth/login', { login: 'gc', password: 'x' }), 400, /Неверный логин/); });
  await step('вход всех ролей', async () => {
    for (const l of ['gc', 'manager', 'mech', 'hand', 'thermo', 'client', 'client2']) T[l] = await login(l);
  });
  await step('без токена → 401, битый токен → 401', async () => {
    await fail(call(null, 'GET', '/state'), 401);
    await fail(call('abc.def.ghi', 'GET', '/state'), 401);
  });
  await step('подрядчик не может создавать объекты → 403', async () => {
    await fail(call(T.mech, 'POST', '/objects', { excelRowNumber: 99, name: 'x', district: 'ЦАО', clientId: CL1, titleM2: 10 }), 403);
  });
  await step('менеджер не имеет доступа к админке → 403', async () => { await fail(call(T.manager, 'PUT', '/admin/settings', { remindFirstDays: 2, remindSecondDays: 5, toleranceM2: 0 }), 403); });

  console.log('Видимость данных');
  await step('ГП видит все 9 объектов, заказчик САО — только свои 2', async () => {
    assert.equal((await S('gc')).objects.length, 9);
    const s = await S('client2');
    assert.deepEqual(s.objects.map((o: any) => o.excelRowNumber).sort(), [2, 7]);
  });
  await step('ТермоЛиния видит только объекты, где назначена (6, 7, 9)', async () => {
    assert.deepEqual((await S('thermo')).objects.map((o: any) => o.excelRowNumber).sort(), [6, 7, 9]);
  });
  await step('подрядчик видит объёмы партнёра, но не его файлы и историю', async () => {
    const s = await S('mech');
    const partner = s.forms.find((f: any) => f.contractorId === HAND && f.lines.length);
    const mine = s.forms.find((f: any) => f.contractorId === MECH && f.schemeFile);
    assert.ok(partner && mine);
    assert.equal(partner.schemeFile, null);
    assert.equal(partner.history.length, 0);
  });
  await step('пароли и логины не утекают в снимок', async () => {
    const s = await S('mech');
    assert.ok(s.users.every((u: any) => u.password === '' && (u.login === '' || u.id === s.users.find((x: any) => x.login === 'mech')?.id)));
  });

  console.log('Объекты и выполнения');
  let objId = '', exId = '';
  await step('ГП создаёт объект 500 м² и выполнение 300 м²', async () => {
    objId = (await ok(call(T.gc, 'POST', '/objects', { excelRowNumber: 101, name: 'Тест-объект', address: 'ул. Тестовая', district: 'ЦАО', clientId: CL1, titleM2: 500 }))).id;
    exId = (await ok(call(T.gc, 'POST', `/objects/${objId}/executions`, { number: 1, name: 'Выполнение №1', periodFrom: '2026-10-01', periodTo: '2026-10-31', titleM2: 300, contractorIds: [MECH, HAND] }))).id;
  });
  await step('сумма выполнений не может превысить объём объекта', async () => {
    await fail(call(T.gc, 'POST', `/objects/${objId}/executions`, { number: 2, name: 'В2', periodFrom: '2026-10-01', periodTo: '2026-10-31', titleM2: 250, contractorIds: [MECH] }), 400, /Доступно: 200/);
  });
  await step('объём объекта нельзя сделать меньше распределённого', async () => {
    await fail(call(T.gc, 'PUT', `/objects/${objId}`, { excelRowNumber: 101, name: 'Тест-объект', district: 'ЦАО', clientId: CL1, titleM2: 200 }), 400, /меньше распределённого/);
  });
  await step('повторный № п/п отклоняется', async () => {
    await fail(call(T.gc, 'POST', '/objects', { excelRowNumber: 1, name: 'дубль', district: 'ЦАО', clientId: CL1, titleM2: 10 }), 400, /уже занят/);
  });
  await step('заказчик САО не может менять объект ЦАО', async () => {
    await fail(call(T.client2, 'PUT', `/objects/${objId}`, { excelRowNumber: 101, name: 'взлом', district: 'ЦАО', clientId: CL1, titleM2: 500 }), 403);
  });
  await step('некорректные данные → 400 с понятным текстом', async () => {
    await fail(call(T.gc, 'POST', '/objects', { name: '', titleM2: -1 }), 400, /Некорректные данные/);
  });

  console.log('Файлы');
  let scheme: any, photo: any, hScheme: any, hPhoto: any;
  await step('подрядчик загружает PDF; не-PDF отклоняется', async () => {
    scheme = (await upload(T.mech, 'SCHEME')).body;
    photo = (await upload(T.mech, 'PHOTO', pdf, 'Фото.pdf')).body;
    hScheme = (await upload(T.hand, 'SCHEME')).body;
    hPhoto = (await upload(T.hand, 'PHOTO')).body;
    assert.equal(scheme.name, 'Схема участка.pdf');
    const bad = await upload(T.mech, 'SCHEME', Buffer.from('not a pdf'), 'virus.exe');
    assert.equal(bad.status, 400);
  });
  await step('нельзя прикрепить чужой файл к своей форме', async () => {
    await fail(call(T.hand, 'POST', `/executions/${exId}/form`, { lines: [], schemeFileId: scheme.id }), 400, /другим пользователем/);
  });

  console.log('Поток согласования: подрядчики → заказчик → ГП');
  const formOf = async (who: string, cid: string, ex = exId) => (await S(who)).forms.find((f: any) => f.executionId === ex && f.contractorId === cid);
  const actOf = async (who: string, ex = exId) => (await S(who)).acts.find((a: any) => a.executionId === ex);
  await step('Механика подаёт 200 м² → ожидание партнёра, недостача 100', async () => {
    const r = await ok(call(T.mech, 'POST', `/executions/${exId}/form`, { lines: [{ markingTypeId: mt['1.1'], linearM: 2000 }], schemeFileId: scheme.id, photoFileId: photo.id, submit: true }));
    assert.match(r.message, /Недостача до титула: 100/);
    assert.equal((await formOf('mech', MECH)).status, 'WAITING_PARTNER');
  });
  await step('Ручка не может превысить титул', async () => {
    await fail(call(T.hand, 'POST', `/executions/${exId}/form`, { lines: [{ markingTypeId: mt['1.14.1'], linearM: 300 }], schemeFileId: hScheme.id, photoFileId: hPhoto.id, submit: true }), 400, /Превышение титула на 20/);
  });
  await step('нельзя подать без файлов', async () => {
    const r = await call(T.hand, 'POST', `/executions/${exId}/form`, { lines: [{ markingTypeId: mt['1.14.1'], linearM: 250 }], schemeFileId: null, photoFileId: null, submit: true });
    assert.equal(r.status, 400); assert.match(r.body.message, /PDF-схема/);
  });
  await step('Ручка подаёт 100 м² → акт создан и ушёл заказчику', async () => {
    const r = await ok(call(T.hand, 'POST', `/executions/${exId}/form`, { lines: [{ markingTypeId: mt['1.14.1'], linearM: 250 }], schemeFileId: hScheme.id, photoFileId: hPhoto.id, submit: true }));
    assert.match(r.message, /сошлись/);
    const a = await actOf('gc');
    assert.equal(a.status, 'ON_CHECK_CLIENT');
    assert.match(a.number, /^АСР-\d{4}$/);
    const n = (await S('client')).notifications.find((x: any) => x.text.includes(a.number) && x.kind === 'action');
    assert.ok(n, 'заказчик получил уведомление «Требует действия»');
  });
  await step('права на файлы: Ручка не скачает файл Механики, заказчик — скачает, чужой заказчик — нет', async () => {
    await fail(call(T.hand, 'GET', `/files/${scheme.id}`), 403);
    const r = await call(T.client, 'GET', `/files/${scheme.id}`);
    assert.equal(r.status, 200); assert.equal(r.body.subarray(0, 5).toString(), '%PDF-');
    await fail(call(T.client2, 'GET', `/files/${scheme.id}`), 403);
  });
  await step('чужой заказчик не может одобрить форму', async () => {
    await fail(call(T.client2, 'POST', `/forms/${(await formOf('gc', MECH)).id}/approve`), 403);
  });
  await step('заказчик одобряет Механику и отклоняет Ручку → акт на доработке', async () => {
    await ok(call(T.client, 'POST', `/forms/${(await formOf('gc', MECH)).id}/approve`));
    await fail(call(T.client, 'POST', `/forms/${(await formOf('gc', HAND)).id}/reject`, { comment: ' ' }), 400, /комментарий/);
    await ok(call(T.client, 'POST', `/forms/${(await formOf('gc', HAND)).id}/reject`, { comment: 'Нет привязки на фото' }));
    assert.equal((await actOf('gc')).status, 'IN_REVISION');
    assert.equal((await formOf('hand', HAND)).status, 'REJECTED_BY_CLIENT');
  });
  await step('Ручка исправляет → акт снова у заказчика (редакция 2), одобрение Механики сохранилось', async () => {
    await ok(call(T.hand, 'POST', `/executions/${exId}/form`, { lines: [{ markingTypeId: mt['1.14.1'], linearM: 250 }], submit: true }));
    const a = await actOf('gc');
    assert.equal(a.status, 'ON_CHECK_CLIENT'); assert.equal(a.round, 2);
    assert.equal((await formOf('gc', MECH)).status, 'APPROVED_BY_CLIENT');
  });
  await step('заказчик одобряет Ручку → все одобрены → акт у ГП', async () => {
    await ok(call(T.client, 'POST', `/forms/${(await formOf('gc', HAND)).id}/approve`));
    assert.equal((await actOf('gc')).status, 'ON_CHECK_GC');
  });
  await step('подрядчик не может отозвать форму, когда акт у ГП', async () => {
    await fail(call(T.mech, 'POST', `/forms/${(await formOf('gc', MECH)).id}/withdraw`), 400, /у генподрядчика/);
  });
  await step('ГП возвращает Ручку; заказчик не видит комментарий ГП', async () => {
    const a = await actOf('gc');
    await ok(call(T.gc, 'POST', `/acts/${a.id}/return`, { contractorIds: [HAND], comment: 'Внутренний комментарий ГП' }));
    assert.equal((await formOf('hand', HAND)).status, 'REJECTED_BY_GC');
    const clientAct = await actOf('client');
    assert.ok(!JSON.stringify(clientAct.history).includes('Внутренний комментарий ГП'));
    const handForm = await formOf('hand', HAND);
    assert.ok(JSON.stringify(handForm.history).includes('Внутренний комментарий ГП'));
  });
  await step('исправление → заказчик → ГП согласует', async () => {
    await ok(call(T.hand, 'POST', `/executions/${exId}/form`, { lines: [{ markingTypeId: mt['1.14.1'], linearM: 250 }], submit: true }));
    await ok(call(T.client, 'POST', `/forms/${(await formOf('gc', HAND)).id}/approve`));
    const a = await actOf('gc');
    assert.equal(a.status, 'ON_CHECK_GC');
    await fail(call(T.mech, 'POST', `/acts/${a.id}/approve`), 403);
    await ok(call(T.manager, 'POST', `/acts/${a.id}/approve`));
    assert.equal((await actOf('gc')).status, 'APPROVED');
  });
  await step('Word: заказчик и ГП скачивают .docx, подрядчик — нет', async () => {
    const a = await actOf('gc');
    const r = await call(T.client, 'POST', `/acts/${a.id}/word`);
    assert.equal(r.status, 200); assert.equal(r.body.subarray(0, 2).toString(), 'PK');
    await ok(call(T.gc, 'POST', `/acts/${a.id}/word`));
    await fail(call(T.mech, 'POST', `/acts/${a.id}/word`), 403);
    assert.equal(await prisma.storedFile.count({ where: { kind: 'WORD_ACT', actWord: { id: a.id } } }), 1);
  });
  await step('корректировка после согласования — только ГП, с причиной и подсветкой', async () => {
    const a = await actOf('gc');
    const rows = [{ contractorId: MECH, lines: [{ markingTypeId: mt['1.1'], linearM: 1990 }] }];
    await fail(call(T.manager, 'POST', `/acts/${a.id}/correct`, { rows, reason: 'x' }), 403);
    await fail(call(T.gc, 'POST', `/acts/${a.id}/correct`, { rows, reason: '' }), 400, /причину/);
    await ok(call(T.gc, 'POST', `/acts/${a.id}/correct`, { rows, reason: 'Обмер на месте' }));
    const h = (await actOf('gc')).history.at(-1);
    assert.match(h.action, /2\s000 → 1\s990/); assert.equal(h.highlight, true);
  });
  await step('архив; удалить выполнение с архивным актом нельзя', async () => {
    const a = await actOf('gc');
    await ok(call(T.gc, 'POST', '/acts/archive', { actIds: [a.id] }));
    assert.equal((await actOf('gc')).status, 'ARCHIVED');
    await fail(call(T.gc, 'DELETE', `/executions/${exId}`), 400, /архивный акт/);
  });

  console.log('Изменение титула, автонули, одновременная подача');
  let ex2 = '';
  await step('изменение титула в ходе согласования: нужна причина, формы → пересчёт, IMPORTANT-уведомления', async () => {
    ex2 = (await ok(call(T.gc, 'POST', `/objects/${objId}/executions`, { number: 2, name: 'Выполнение №2', periodFrom: '2026-10-01', periodTo: '2026-10-31', titleM2: 150, contractorIds: [MECH, HAND] }))).id;
    const s2 = (await upload(T.mech, 'SCHEME')).body, p2 = (await upload(T.mech, 'PHOTO')).body;
    await ok(call(T.mech, 'POST', `/executions/${ex2}/form`, { lines: [{ markingTypeId: mt['1.1'], linearM: 1000 }], schemeFileId: s2.id, photoFileId: p2.id, submit: true }));
    const body = { number: 2, name: 'Выполнение №2', periodFrom: '2026-10-01', periodTo: '2026-10-31', titleM2: 180, contractorIds: [MECH, HAND] };
    await fail(call(T.gc, 'PUT', `/executions/${ex2}`, body), 400, /причину/);
    await ok(call(T.gc, 'PUT', `/executions/${ex2}`, { ...body, reason: 'Уточнён титул' }));
    const s = await S('mech');
    assert.equal(s.forms.find((f: any) => f.executionId === ex2 && f.contractorId === MECH).status, 'TITLE_CHANGED');
    assert.deepEqual(s.executions.find((e: any) => e.id === ex2).titleChange?.to, 180);
    assert.ok((await S('client')).notifications.some((n: any) => n.kind === 'important' && n.text.includes('150 → 180')));
  });
  await step('Механика закрывает весь объём → Ручке автоформа с нулями, акт создан, предупреждение о титуле снято', async () => {
    await ok(call(T.mech, 'POST', `/executions/${ex2}/form`, { lines: [{ markingTypeId: mt['1.1'], linearM: 1800 }], submit: true }));
    const hf = await formOf('hand', HAND, ex2);
    assert.equal(hf.autoZero, true); assert.equal(hf.status, 'ON_CHECK_CLIENT');
    assert.equal((await actOf('gc', ex2)).status, 'ON_CHECK_CLIENT');
    assert.equal((await S('gc')).executions.find((e: any) => e.id === ex2).titleChange, null);
  });
  await step('отзыв формы сбрасывает автонули партнёра, акт → доработка', async () => {
    await ok(call(T.mech, 'POST', `/forms/${(await formOf('gc', MECH, ex2)).id}/withdraw`));
    const hf = await formOf('hand', HAND, ex2);
    assert.equal(hf.status, 'DRAFT'); assert.equal(hf.autoZero, false);
    assert.equal((await actOf('gc', ex2)).status, 'IN_REVISION');
  });
  await step('одновременная подача двух форм не превышает титул (блокировка строки)', async () => {
    const ex3 = (await ok(call(T.gc, 'POST', `/objects/${objId}/executions`, { number: 3, name: 'Выполнение №3', periodFrom: '2026-10-01', periodTo: '2026-10-31', titleM2: 20, contractorIds: [MECH, HAND] }))).id;
    const [ms, mp, hs, hp] = await Promise.all([upload(T.mech, 'SCHEME'), upload(T.mech, 'PHOTO'), upload(T.hand, 'SCHEME'), upload(T.hand, 'PHOTO')]);
    const res = await Promise.all([
      call(T.mech, 'POST', `/executions/${ex3}/form`, { lines: [{ markingTypeId: mt['1.1'], linearM: 150 }], schemeFileId: ms.body.id, photoFileId: mp.body.id, submit: true }),
      call(T.hand, 'POST', `/executions/${ex3}/form`, { lines: [{ markingTypeId: mt['1.14.1'], linearM: 40 }], schemeFileId: hs.body.id, photoFileId: hp.body.id, submit: true }),
    ]);
    const statuses = res.map((r) => r.status).sort();
    assert.deepEqual(statuses, [200, 400], `обе подачи по 15 и 16 м² при титуле 20: ${JSON.stringify(res.map((r) => r.body.message))}`);
    const submitted = await prisma.contractorForm.aggregate({ where: { executionId: ex3, status: { in: ['WAITING_PARTNER', 'ON_CHECK_CLIENT'] } }, _sum: { totalM2: true } });
    assert.ok(Number(submitted._sum.totalM2) <= 20);
  });

  console.log('Напоминания, админка, сессии, удаление');
  await step('напоминания 2/5 дней: срабатывают один раз, ГП получает одну сводку', async () => {
    await prisma.execution.update({ where: { id: ex2 }, data: { lastActivityAt: new Date(Date.now() - 6 * 86400000), reminderLevel: 0 } });
    const before = await prisma.notification.count({ where: { kind: 'REMINDER' } });
    const r1 = await ok(call(T.gc, 'POST', '/admin/reminders/run'));
    assert.ok(r1.second >= 1);
    const r2 = await ok(call(T.gc, 'POST', '/admin/reminders/run'));
    assert.equal(r2.second, 0);
    const gcDigest = (await S('gc')).notifications.filter((n: any) => n.kind === 'reminder' && n.text.startsWith('Сводка'));
    assert.ok(gcDigest.length >= 1);
    assert.ok((await prisma.notification.count({ where: { kind: 'REMINDER' } })) > before);
  });
  await step('коэффициент вида разметки: несогласованные формы пересчитаны, архивный акт — нет', async () => {
    const archivedBefore = await prisma.act.findFirstOrThrow({ where: { executionId: exId } });
    const t = await prisma.markingType.findUniqueOrThrow({ where: { id: mt['1.14.1'] } });
    await ok(call(T.gc, 'PUT', `/admin/marking-types/${t.id}`, { code: t.code, name: t.name, widthM: 0.5, fillRatio: 1 }));
    const archivedAfter = await prisma.act.findFirstOrThrow({ where: { executionId: exId } });
    assert.equal(Number(archivedAfter.totalM2), Number(archivedBefore.totalM2));
    const draft = await prisma.formLine.findFirst({ where: { markingTypeId: t.id, form: { execution: { act: { is: null } } } } });
    if (draft) assert.equal(Number(draft.areaM2), Math.round(Number(draft.linearM) * 0.5 * 100) / 100);
    await ok(call(T.gc, 'PUT', `/admin/marking-types/${t.id}`, { code: t.code, name: t.name, widthM: 0.4, fillRatio: 1 }));
  });
  await step('ГП создаёт пользователя; смена пароля завершает старые сессии', async () => {
    const u = await ok(call(T.gc, 'POST', '/admin/users', { name: 'Тестов', login: 'tester', password: 'secret1', role: 'MANAGER' }));
    const old = await login('tester', 'secret1');
    await ok(call(old, 'GET', '/state'));
    await new Promise((r) => setTimeout(r, 1100));
    await ok(call(T.gc, 'PUT', `/admin/users/${u.id}`, { name: 'Тестов', login: 'tester', password: 'secret2', role: 'MANAGER' }));
    await fail(call(old, 'GET', '/state'), 401, /Пароль был изменён/);
    await ok(call(await login('tester', 'secret2'), 'GET', '/state'));
    await fail(call(T.gc, 'DELETE', `/admin/users/${(await prisma.user.findUniqueOrThrow({ where: { login: 'gc' } })).id}`), 400, /себя/);
    await ok(call(T.gc, 'DELETE', `/admin/users/${u.id}`));
  });
  await step('чат: участник пишет, посторонний подрядчик — нет', async () => {
    await ok(call(T.mech, 'POST', `/objects/${objId}/chat`, { text: 'Начинаем завтра' }));
    await fail(call(T.thermo, 'POST', `/objects/${objId}/chat`, { text: 'привет' }), 403);
    assert.ok((await S('client')).chat.some((m: any) => m.text === 'Начинаем завтра'));
  });
  await step('уведомления: «прочитать все»', async () => {
    await ok(call(T.client, 'POST', '/notifications/read', { ids: 'all' }));
    assert.equal((await S('client')).notifications.filter((n: any) => !n.read).length, 0);
  });
  await step('удаление объекта с архивным актом запрещено; без него — каскадно с файлами', async () => {
    await fail(call(T.gc, 'DELETE', `/objects/${objId}`), 400, /архивный акт/);
    const o9 = (await S('gc')).objects.find((o: any) => o.excelRowNumber === 9);
    await fail(call(T.client2, 'DELETE', `/objects/${o9.id}`), 403);
    await ok(call(T.client, 'DELETE', `/objects/${o9.id}`));
    assert.equal(await prisma.siteObject.count({ where: { id: o9.id } }), 0);
    assert.ok((await S('mech')).notifications.some((n: any) => n.text.includes('удалил объект №9')));
  });

  console.log(results.join('\n'));
  console.log(`\nИтого: ${passed} проверок пройдено`);
}

main().catch(() => process.exit(1)).finally(() => prisma.$disconnect());
