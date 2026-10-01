/**
 * Инициализация ЧИСТОЙ базы для реальной работы (без демо-данных). Ничего не удаляет, можно запускать повторно.
 *   ADMIN_LOGIN=admin ADMIN_PASSWORD='…' ADMIN_NAME='Иванов И.' npx tsx prisma/init.ts
 * Создаёт: строку настроек, справочник видов разметки (если пуст), пользователя-ГП (если такого логина нет).
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { hashPassword } from '../src/common/password';

const prisma = new PrismaClient();

const MARKING_TYPES: [string, string, number, number][] = [
  ['1.1', 'Сплошная линия', 0.1, 1],
  ['1.2', 'Краевая сплошная линия', 0.2, 1],
  ['1.3', 'Двойная сплошная (2×0,10)', 0.2, 1],
  ['1.5', 'Прерывистая 1:3', 0.1, 0.25],
  ['1.6', 'Линия приближения 3:1', 0.1, 0.75],
  ['1.7', 'Прерывистая 1:1 (на перекрёстках)', 0.1, 0.5],
  ['1.12', 'Стоп-линия', 0.4, 1],
  ['1.14.1', 'Пешеходный переход «зебра»', 0.4, 1],
];

async function main() {
  const login = (process.env.ADMIN_LOGIN || 'admin').trim();
  const password = process.env.ADMIN_PASSWORD || '';
  const name = process.env.ADMIN_NAME || 'Администратор (ГП)';
  if (password.length < 8) throw new Error('Задайте ADMIN_PASSWORD (не короче 8 символов)');

  await prisma.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1, remindFirstDays: 2, remindSecondDays: 5, toleranceM2: new Prisma.Decimal(0) } });

  if ((await prisma.markingType.count()) === 0) {
    for (const [i, [code, mtName, w, f]] of MARKING_TYPES.entries()) {
      await prisma.markingType.create({ data: { code, name: mtName, widthM: new Prisma.Decimal(w), fillRatio: new Prisma.Decimal(f), sortOrder: i } });
    }
    console.log(`Справочник видов разметки: добавлено ${MARKING_TYPES.length} (коэффициенты проверьте в админке)`);
  }

  const exists = await prisma.user.findUnique({ where: { login } });
  if (exists) console.log(`Пользователь «${login}» уже есть — не трогаю`);
  else {
    await prisma.user.create({ data: { login, name, role: 'GC', passwordHash: hashPassword(password) } });
    console.log(`Создан ГП: ${login}`);
  }
}

main().catch((e) => { console.error(e.message || e); process.exit(1); }).finally(() => prisma.$disconnect());
