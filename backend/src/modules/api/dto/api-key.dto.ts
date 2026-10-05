import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';
import { DEFAULT_API_KEY_RATE_LIMIT } from '../constants/api-key.constants';

/**
 * Body für POST /api/api-keys — Anlage eines neuen API-Keys.
 *
 * `name`, `scopes` und `rateLimit` werden vom aufrufenden KANZLEI_ADMIN
 * gesetzt. `expiresAt` ist optional (null = unbegrenzt).
 */
export class CreateApiKeyDto {
  @ApiProperty({
    description:
      'Kanzlei, fuer die der Key gilt. Erforderlich — der Aufrufer ist ' +
      'selbst dafuer verantwortlich, sie korrekt zu waehlen.',
    example: 'b1a2c3d4-0000-4000-8000-000000000000',
    format: 'uuid',
  })
  // Bugfix 2026-10-05: `kanzleiId` fehlte im DTO und wurde im Controller nur
  // per Typ-Intersection `CreateApiKeyDto & { kanzleiId: string }`
  // behauptet. Die ValidationPipe prueft nur dekorierte Properties — ohne
  // Dekorator blieb `undefined` ungeprueft, und `kanzlei: { connect: {
  // id: undefined } }` liess Prisma mit HTTP 500 abbrechen. Fehlende
  // Pflichtangabe des Clients gehoeren zu 400, nicht zu 500.
  @IsUUID('4', { message: 'kanzleiId muss eine gueltige UUID sein' })
  kanzleiId!: string;

  @ApiProperty({
    description:
      'Menschenlesbarer Name für den API-Key (z.B. "DATEV-Integration-Production")',
    example: 'DATEV-Integration-Production',
  })
  @IsString()
  @Length(2, 200, { message: 'name muss zwischen 2 und 200 Zeichen lang sein' })
  name!: string;

  @ApiProperty({
    description:
      'Liste der OAuth2-Scopes, die der Key erhalten soll. ' +
      'Mindestens 1, max 10. Format: "<resource>:<action>".',
    example: ['mandant:read', 'bilanz:read', 'bilanz:write'],
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'mindestens 1 Scope erforderlich' })
  @ArrayMaxSize(10, { message: 'maximal 10 Scopes pro Key' })
  @IsString({ each: true })
  scopes!: string[];

  @ApiProperty({
    description:
      'Rate-Limit pro Stunde (default 1000). Wird serverseitig erzwungen.',
    example: 1000,
    required: false,
    default: DEFAULT_API_KEY_RATE_LIMIT,
  })
  @IsOptional()
  @IsInt({ message: 'rateLimit muss eine Ganzzahl sein' })
  @Min(1, { message: 'rateLimit muss >= 1 sein' })
  @Max(100_000, { message: 'rateLimit darf max 100000 sein' })
  @Type(() => Number)
  rateLimit?: number;

  @ApiProperty({
    description:
      'Optionaler Ablaufzeitpunkt (ISO-8601). null/undefined = unbegrenzt gültig.',
    example: '2026-12-31T23:59:59Z',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsDateString({}, { message: 'expiresAt muss ISO-8601 sein' })
  expiresAt?: string;
}

/**
 * Öffentlicher API-Key-Datensatz (OHNE plaintextSecret).
 *
 * `plaintextSecret` wird NIE über die API zurückgegeben — nur der SHA-256-
 * Hash bleibt in der DB.
 */
export class ApiKeyDto {
  @ApiProperty({ description: 'API-Key-UUID' })
  id!: string;

  @ApiProperty({ description: 'Kanzlei-ID, an die der Key gebunden ist' })
  kanzleiId!: string;

  @ApiProperty({ description: 'Menschenlesbarer Name' })
  name!: string;

  @ApiProperty({
    description:
      'Öffentliche Key-ID (z.B. "ak_abc123def456") — wird im Token zusammen mit dem Secret verwendet.',
    example: 'ak_abc123def456',
  })
  keyId!: string;

  @ApiProperty({
    description: 'Aktive Scopes',
    type: [String],
    example: ['mandant:read', 'bilanz:read'],
  })
  scopes!: string[];

  @ApiProperty({ description: 'Rate-Limit (Requests/Stunde)', example: 1000 })
  rateLimit!: number;

  @ApiProperty({ description: 'Ablaufzeitpunkt (null = unbegrenzt)', nullable: true })
  expiresAt!: Date | null;

  @ApiProperty({ description: 'Key aktiv?', example: true })
  isActive!: boolean;

  @ApiProperty({ description: 'Letzte Nutzung (null = nie)', nullable: true })
  lastUsedAt!: Date | null;

  @ApiProperty({ description: 'Erstellt am' })
  createdAt!: Date;

  @ApiProperty({ description: 'Widerrufen am (null = aktiv)', nullable: true })
  revokedAt!: Date | null;
}

/**
 * Antwort eines neu angelegten API-Keys.
 *
 * Enthält den öffentlichen Datensatz (`apiKey`) + den EINMALIG sichtbaren
 * `plaintextSecret`. Letzterer MUSS vom User kopiert werden — wir
 * speichern nur den SHA-256-Hash.
 */
export class CreateApiKeyResponseDto {
  @ApiProperty({ description: 'Öffentlicher API-Key-Datensatz' })
  apiKey!: ApiKeyDto;

  @ApiProperty({
    description:
      'Plaintext-Secret des API-Keys. Wird NUR EINMAL bei Create zurückgegeben — sicher kopieren!',
    example: 'k9PqL2nR7xY3mFvH8cJ6wT5sN1bD4gA0',
  })
  plaintextSecret!: string;
}

/**
 * API-Key-Usage-Eintrag (für Analytics-Anzeige im UI).
 */
export class ApiKeyUsageDto {
  @ApiProperty({ description: 'Endpoint-Pattern', example: 'GET /api/v1/mandanten' })
  endpoint!: string;

  @ApiProperty({ description: 'HTTP-Statuscode', example: 200 })
  statusCode!: number;

  @ApiProperty({ description: 'Zeitpunkt' })
  timestamp!: Date;

  @ApiProperty({ description: 'IP-Adresse', nullable: true, required: false })
  ipAddress!: string | null;

  @ApiProperty({ description: 'Response-Time in ms', nullable: true, required: false })
  responseTimeMs!: number | null;
}