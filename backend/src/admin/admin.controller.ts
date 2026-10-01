import { Body, Controller, Delete, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import { nonneg, num, parse, uuid, z } from '../common/zod';
import { RemindersService } from '../notifications/reminders.service';
import { AdminService } from './admin.service';

const userSchema = z.object({
  name: z.string().trim().min(1), login: z.string().trim().min(1), password: z.string().optional().transform((x) => x || undefined),
  role: z.enum(['GC', 'MANAGER', 'CONTRACTOR', 'CLIENT']), contractorId: uuid.nullish(), clientId: uuid.nullish(), active: z.boolean().optional(),
});
const contractorSchema = z.object({ name: z.string().trim().min(1), specialization: z.string().trim().min(1) });
const clientSchema = z.object({ name: z.string().trim().min(1) });
const mtSchema = z.object({ code: z.string().trim().min(1), name: z.string().trim().min(1), widthM: num.positive(), fillRatio: num.positive().max(1) });
const settingsSchema = z.object({ remindFirstDays: z.coerce.number().int().min(1), remindSecondDays: z.coerce.number().int().min(1), toleranceM2: nonneg });

/** Админка — только GC (MANAGER — «всё, кроме управления пользователями», но админка в прототипе только у GC). */
@Roles('GC')
@Controller('admin')
export class AdminController {
  constructor(private admin: AdminService, private reminders: RemindersService) {}

  @Post('users') createUser(@CurrentUser() u: AuthUser, @Body() b: unknown) { return this.admin.saveUser(u, null, parse(userSchema, b)); }
  @Put('users/:id') updateUser(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.admin.saveUser(u, id, parse(userSchema, b)); }
  @Delete('users/:id') deleteUser(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.admin.deleteUser(u, id); }

  @Post('contractors') createContractor(@Body() b: unknown) { return this.admin.saveContractor(null, parse(contractorSchema, b)); }
  @Put('contractors/:id') updateContractor(@Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.admin.saveContractor(id, parse(contractorSchema, b)); }
  @Delete('contractors/:id') deleteContractor(@Param('id', ParseUUIDPipe) id: string) { return this.admin.deleteContractor(id); }

  @Post('clients') createClient(@Body() b: unknown) { return this.admin.saveClient(null, parse(clientSchema, b)); }
  @Put('clients/:id') updateClient(@Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.admin.saveClient(id, parse(clientSchema, b)); }
  @Delete('clients/:id') deleteClient(@Param('id', ParseUUIDPipe) id: string) { return this.admin.deleteClient(id); }

  @Post('marking-types') createMt(@Body() b: unknown) { return this.admin.saveMarkingType(null, parse(mtSchema, b)); }
  @Put('marking-types/:id') updateMt(@Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.admin.saveMarkingType(id, parse(mtSchema, b)); }
  @Delete('marking-types/:id') deleteMt(@Param('id', ParseUUIDPipe) id: string) { return this.admin.deleteMarkingType(id); }

  @Put('settings') settings(@Body() b: unknown) { return this.admin.saveSettings(parse(settingsSchema, b)); }

  @Post('reminders/run') @HttpCode(200)
  async runReminders() {
    const r = await this.reminders.run();
    return { ...r, message: `Проверка выполнена: напоминаний 2 дн. — ${r.first}, 5 дн. — ${r.second}` };
  }
}
