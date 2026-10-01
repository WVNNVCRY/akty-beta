import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { AdminController } from './admin/admin.controller';
import { AdminService } from './admin/admin.service';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './common/auth';
import { FilesController } from './files/files.controller';
import { StorageService } from './files/storage.service';
import { HealthController } from './health.controller';
import { NotifyService } from './notifications/notify.service';
import { RemindersService } from './notifications/reminders.service';
import { TelegramController } from './notifications/telegram.controller';
import { TelegramService } from './notifications/telegram.service';
import { PrismaService } from './prisma.service';
import { StateService } from './state/state.service';
import { ActsService } from './workflow/acts.service';
import { ApiController } from './workflow/api.controller';
import { FormsService } from './workflow/forms.service';
import { ObjectsService } from './workflow/objects.service';

if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET не задан');
  console.warn('JWT_SECRET не задан — используется dev-значение');
}

/** Собранный фронтенд (npm run build:api в корне) раздаётся тем же сервером — один порт, без CORS. */
const webDir = resolve(process.env.WEB_DIR || resolve(__dirname, '../../dist-api'));

@Module({
  imports: [
    JwtModule.register({ global: true, secret: process.env.JWT_SECRET || 'dev-secret-change-me', signOptions: { expiresIn: '30d' } }),
    ScheduleModule.forRoot(),
    ...(existsSync(webDir) ? [ServeStaticModule.forRoot({ rootPath: webDir, exclude: ['/api/{*any}'] })] : []),
  ],
  controllers: [HealthController, AuthController, ApiController, FilesController, AdminController, TelegramController],
  providers: [
    PrismaService, StorageService, NotifyService, TelegramService, RemindersService,
    StateService, FormsService, ActsService, ObjectsService, AdminService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
