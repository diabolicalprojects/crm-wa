import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadConfig } from './config';

async function bootstrap() {
  const log = new Logger('Bootstrap');
  // Falla temprano y con detalle si el entorno está incompleto.
  const config = loadConfig();

  const app = await NestFactory.create(AppModule, {
    // Necesario para verificar el HMAC de OpenWA sobre los bytes originales:
    // recalcular la firma sobre un cuerpo re-serializado nunca coincide.
    rawBody: true,
  });

  app.setGlobalPrefix('api/v1');
  app.enableCors({ origin: config.corsOrigins, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.enableShutdownHooks();

  await app.listen(config.port, '0.0.0.0');
  log.log(`API en el puerto ${config.port} · webhooks en ${config.publicApiUrl}`);
}

bootstrap();
