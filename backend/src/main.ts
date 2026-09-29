import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, raw } from 'express';
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
  //
  // Bugfix 2026-09-28: `exclude: ['health']` schliesst NUR exakt `/health` aus,
  // NICHT `/health/ready`. Die Readiness-Probe wurde dadurch unter `/api/health/ready`
  // einsortiert (404 unter dem dokumentierten Pfad). Da die Readiness-Probe das
  // Kriterium fuer den NGINX-Blue-Green-Switch ist (RUNBOOK), wuerde der
  // Load-Balancer nie umschalten.
  //
  // Nest 11 matcht `exclude` per Pfad-Pattern; `{*splat}` deckt beliebige
  // Unterpfade ab. Beide Health-Pfade sind zudem ueber @Public() von der Auth
  // ausgenommen (HealthController).
  app.setGlobalPrefix('api', {
    exclude: ['health', 'health/{*splat}'],
  });

  // =========================================================================
  // Raw-Body für Stripe-Webhook (M4 Sprint 3)
  // =========================================================================
  // Stripe-Webhook-Signatur-Verifikation benötigt den exakten Original-Body.
  // Wir registrieren einen raw-Parser VOR dem JSON-Parser, der nur für die
  // Subscription-Webhook-Route aktiv ist.
  app.use(
    '/api/subscription/webhook',
    raw({ type: '*/*', limit: '1mb' }),
    (req: unknown, _res: unknown, next: unknown) => {
      // Express raw-parser liefert Buffer in req.body — wir speichern ihn
      // in req.rawBody für den Controller.
      const r = req as { body?: unknown; rawBody?: Buffer };
      if (Buffer.isBuffer(r.body)) {
        r.rawBody = r.body;
        // req.body darf nicht doppelt geparst werden → als leeres Objekt
        // weiterreichen, damit Validation-Pipe nicht scheitert.
        r.body = {};
      }
      (next as () => void)();
    },
  );
  // Alle anderen Routes: JSON-Parser (Standard)
  app.use(json({ limit: '10mb' }));

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