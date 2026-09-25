import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const configService = app.get(ConfigService);

  // Helmet — Security Headers
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  // CORS
  const frontendUrl = configService.get<string>(
    'FRONTEND_URL',
    'http://localhost:3000',
  );
  const allowedOrigins = frontendUrl
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('CORS: Origin nicht erlaubt'), false);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'x-mandant-id',
    ],
  });

  // Globales Prefix
  app.setGlobalPrefix('api', {
    exclude: ['health'],
  });

  // Globale ValidationPipe (class-validator + class-transformer)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // ===========================================================================
  // OpenAPI 3.1 Spec (M4 Sprint 1)
  // ===========================================================================
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Bundesanzeiger Jahresabschluss Public API')
    .setDescription(
      'OAuth2-API für externe Integrationen (DATEV, Addison, ERP-Systeme). ' +
        'Machine-to-Machine via client_credentials-Grant.',
    )
    .setVersion('1.0.0')
    .addOAuth2(
      {
        type: 'oauth2',
        flows: {
          clientCredentials: {
            tokenUrl: '/oauth/token',
            scopes: {
              'mandant:read': 'Mandanten lesen',
              'bilanz:read': 'Bilanzen lesen',
              'bilanz:write': 'Bilanzen schreiben',
              'guv:read': 'GuV lesen',
              'guv:write': 'GuV schreiben',
              'anhang:read': 'Anhang lesen',
              'jahresabschluss:read': 'Jahresabschlüsse lesen',
              'jahresabschluss:write': 'Jahresabschlüsse schreiben',
              'banz-submission:write': 'BAnz-Submissions erstellen',
              'webhook:manage': 'Webhooks verwalten',
            },
          },
        },
      },
      'oauth2',
    )
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'API-Key',
        description:
          'API-Key-Format: ak_<keyId>.<secret> (siehe /api/api-keys). ' +
          'Oder OAuth2-JWT: Bearer <jwt>',
      },
      'bearer',
    )
    .addServer('/api/v1', 'Version 1')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
    },
  });

  const port = configService.get<number>('PORT', 3000);
  await app.listen(port);

  logger.log(`Backend läuft auf http://localhost:${String(port)}`);
  logger.log(`CORS erlaubte Origins: ${allowedOrigins.join(', ')}`);
  logger.log(`OpenAPI-Spec: http://localhost:${String(port)}/api/docs`);
}

void bootstrap();