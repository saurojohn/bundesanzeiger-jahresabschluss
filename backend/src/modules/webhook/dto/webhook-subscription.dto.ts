import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  Length,
} from 'class-validator';
import { WEBHOOK_EVENTS, type WebhookEvent } from '../constants/webhook-events.constants';

/**
 * Body für POST /api/webhook-subscriptions.
 *
 * Das `secret` wird VOM Client gesetzt (32+ Zeichen), damit der Subscriber
 * die eingehenden Webhooks verifizieren kann. Wird im Klartext gespeichert
 * (nicht hashen) — das Secret MUSS für HMAC-Signatur lesbar bleiben.
 */
export class CreateWebhookSubscriptionDto {
  @ApiProperty({
    description: 'Webhook-URL (HTTPS empfohlen, HTTP für Dev OK)',
    example: 'https://datev.example.com/webhooks/banz',
  })
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true },
    { message: 'url muss eine gültige HTTP/HTTPS-URL sein' },
  )
  url!: string;

  @ApiProperty({
    description: 'Liste der abonnierten Events',
    enum: WEBHOOK_EVENTS,
    isArray: true,
    example: ['banz.submission.published', 'bilanz.updated'],
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'mindestens 1 Event erforderlich' })
  @ArrayMaxSize(20, { message: 'maximal 20 Events pro Subscription' })
  @IsString({ each: true })
  events!: WebhookEvent[];

  @ApiProperty({
    description:
      'Optional: eigenes HMAC-Secret (32+ Zeichen). ' +
      'Wird für die Signatur-Berechnung verwendet. ' +
      'Wenn weggelassen, generiert der Server ein zufälliges Secret.',
    required: false,
    example: 'k9PqL2nR7xY3mFvH8cJ6wT5sN1bD4gA0',
  })
  @IsOptional()
  @IsString()
  @Length(32, 200, { message: 'secret muss zwischen 32 und 200 Zeichen lang sein' })
  secret?: string;
}

/**
 * Public-DTO für Webhook-Subscription (OHNE secret).
 */
export class WebhookSubscriptionDto {
  @ApiProperty({ description: 'Subscription-UUID' })
  id!: string;

  @ApiProperty({ description: 'Kanzlei-ID' })
  kanzleiId!: string;

  @ApiProperty({ description: 'Webhook-URL' })
  url!: string;

  @ApiProperty({ description: 'Abonnierte Events', type: [String] })
  events!: string[];

  @ApiProperty({ description: 'Subscription aktiv?', example: true })
  isActive!: boolean;

  @ApiProperty({ description: 'Erstellt am' })
  createdAt!: Date;

  @ApiProperty({ description: 'Letzte Delivery', nullable: true })
  lastDeliveryAt!: Date | null;

  @ApiProperty({ description: 'Status der letzten Delivery', nullable: true })
  lastDeliveryStatus!: number | null;
}

/**
 * Antwort bei Create — enthält einmalig das plaintext-Secret.
 */
export class CreateWebhookSubscriptionResponseDto {
  @ApiProperty({ description: 'Subscription (ohne Secret)' })
  subscription!: WebhookSubscriptionDto;

  @ApiProperty({
    description:
      'Plaintext-Secret. Wird NUR EINMAL bei Create zurückgegeben — sicher speichern!',
    example: 'k9PqL2nR7xY3mFvH8cJ6wT5sN1bD4gA0',
  })
  plaintextSecret!: string;
}

/**
 * Body für Test-Webhook-Delivery (POST /api/webhook-subscriptions/:id/test).
 */
export class TestWebhookDeliveryDto {
  @ApiProperty({
    description: 'Event-Typ für Test',
    enum: WEBHOOK_EVENTS,
    example: 'banz.submission.published',
  })
  @IsString()
  @IsEnum(WEBHOOK_EVENTS, { message: 'event muss ein gültiger Webhook-Event sein' })
  @Type(() => String)
  event!: WebhookEvent;
}

/**
 * Public-DTO für Webhook-Delivery (read-only).
 */
export class WebhookDeliveryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  subscriptionId!: string;

  @ApiProperty()
  event!: string;

  @ApiProperty({ description: 'Versuchs-Anzahl', example: 0 })
  attemptCount!: number;

  @ApiProperty({ description: 'Max. Versuche', example: 3 })
  maxAttempts!: number;

  @ApiProperty({
    description: 'Status',
    enum: ['PENDING', 'SUCCESS', 'FAILED', 'DEAD_LETTER'],
  })
  status!: string;

  @ApiProperty({ description: 'HTTP-Statuscode der letzten Antwort', nullable: true })
  responseCode!: number | null;

  @ApiProperty({ description: 'Response-Body (erste 500 Zeichen)', nullable: true })
  responseBody!: string | null;

  @ApiProperty({ description: 'Fehlermeldung', nullable: true })
  errorMessage!: string | null;

  @ApiProperty({ description: 'Geplant für' })
  scheduledAt!: Date;

  @ApiProperty({ description: 'Abgeschlossen am', nullable: true })
  completedAt!: Date | null;

  @ApiProperty({ description: 'Nächster Retry-Zeitpunkt', nullable: true })
  nextRetryAt!: Date | null;
}