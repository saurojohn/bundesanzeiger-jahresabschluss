import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsString } from 'class-validator';

/**
 * OAuth2 Token-Request (POST /oauth/token, client_credentials-Grant).
 *
 * Per RFC 6749 §4.4: `application/x-www-form-urlencoded` mit den Feldern
 * `grant_type`, `client_id`, `client_secret`. Wir akzeptieren zusätzlich
 * JSON-Bodies (DATEV / Addison senden idR JSON) — die ValidationPipe
 * normalisiert beide.
 */
export class OAuthTokenRequestDto {
  @ApiProperty({
    description: 'OAuth2-Grant-Typ. Nur "client_credentials" wird unterstützt.',
    enum: ['client_credentials'],
    example: 'client_credentials',
  })
  @IsIn(['client_credentials'], {
    message: 'grant_type muss "client_credentials" sein',
  })
  grant_type!: 'client_credentials';

  @ApiProperty({
    description: 'API-Key-KeyID (z.B. "ak_abc123def456")',
    example: 'ak_abc123def456',
  })
  @IsString()
  client_id!: string;

  @ApiProperty({
    description: 'API-Key-Secret (Plaintext). Wird nur per HTTPS übertragen.',
    example: 'k9PqL2nR7xY3mFvH8cJ6wT5sN1bD4gA0',
  })
  @IsString()
  client_secret!: string;

  @ApiProperty({
    description:
      'Optional: gewünschte Scopes (space-separated). ' +
      'Muss eine Teilmenge der im API-Key hinterlegten Scopes sein.',
    required: false,
    example: 'mandant:read bilanz:read',
  })
  @IsString()
  scope?: string;
}

/**
 * OAuth2 Token-Response (RFC 6749 §5.1).
 */
export class OAuthTokenResponseDto {
  @ApiProperty({
    description: 'JWT-Access-Token. Wird als "Authorization: Bearer <token>" verwendet.',
  })
  @IsString()
  access_token!: string;

  @ApiProperty({ description: 'Token-Typ', enum: ['Bearer'], example: 'Bearer' })
  @IsIn(['Bearer'])
  token_type!: 'Bearer';

  @ApiProperty({ description: 'Gültigkeit in Sekunden', example: 3600 })
  @IsInt()
  expires_in!: number;

  @ApiProperty({
    description: 'Tatsächlich gewährte Scopes (space-separated).',
    example: 'mandant:read bilanz:read',
  })
  @IsString()
  scope!: string;
}