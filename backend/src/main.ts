import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/errors';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: process.env.LOG_ROUTES ? ['log', 'warn', 'error'] : ['warn', 'error'] });
  app.setGlobalPrefix('api', { exclude: [] });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();
  const port = Number(process.env.PORT || 3000);
  await app.listen(port, '0.0.0.0');
  console.log(`API: http://0.0.0.0:${port}/api`);
}
bootstrap();
