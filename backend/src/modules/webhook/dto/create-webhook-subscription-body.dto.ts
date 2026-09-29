import { IsString, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { CreateWebhookSubscriptionDto } from './webhook-subscription.dto';

/**
 * Request-Body fuer POST /api/webhook-subscriptions.
 *
 * Warum ein eigener Typ statt `CreateWebhookSubscriptionDto & { kanzleiId: string }`:
 * TypeScript loest Kreuz-Typen (Intersection Types) beim Emit zu `Object`
 * auf. `emitDecoratorMetadata` schreibt daher `design:type = Object` in den
 * Constructor-Parametern, und NestJS kann den Typ nicht als DTO erkennen —
 * die Validierung wurde dann stillschweigend KOMPLETT uebersprungen.
 *
 * Konsequenz im Original: `url: 'not-a-url'` wurde mit HTTP 201 akzeptiert
 * und als Abholpunkt gespeichert. Da die Webhook-Auslieferung diesen Wert
 * als Ziel-URL verwendet, ist das zugleich ein SSRF-Risiko.
 *
 * Mit dieser echten Klasse greift wieder die ValidationPipe inkl. @IsUrl.
 */
export class CreateWebhookSubscriptionBodyDto extends CreateWebhookSubscriptionDto {
  /**
   * Kanzlei, in deren Namen die Subscription angelegt wird.
   *
   * Eigene Validierungs-Decoratoren sind zwingend: die globale ValidationPipe
   * laeuft mit `whitelist: true, forbidNonWhitelisted: true`. Properties ohne
   * Decorator stehen nicht in der class-validator-Metadatenliste und werden
   * daher als "unbekannt" abgelehnt ("property kanzleiId should not exist").
   */
  @ApiProperty({ description: 'Kanzlei-ID, in deren Namen die Subscription laeuft' })
  @IsString({ message: 'kanzleiId muss ein String sein' })
  @IsUUID('4', { message: 'kanzleiId muss eine gueltige UUID sein' })
  kanzleiId!: string;
}
