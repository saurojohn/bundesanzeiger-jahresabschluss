import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiKeyService } from '../services/api-key.service';
import { asAPIScope } from '../constants/api-key.constants';
import {
  OAuthTokenRequestDto,
  OAuthTokenResponseDto,
} from '../dto/oauth-token.dto';

/**
 * OAuth2 Token-Endpoint (RFC 6749 §4.4 — client_credentials-Grant).
 *
 * Akzeptiert JSON-Bodies (DATEV/Addison-üblich) zusätzlich zum
 * Standard-`application/x-www-form-urlencoded` (durch ValidationPipe
 * tolerant).
 *
 * Erfolgreiche Antwort liefert einen JWT-Access-Token (HS256, 1h TTL)
 * mit Claims:
 *   - sub:        API-Key-ID
 *   - kanzleiId:  gebundene Kanzlei
 *   - scopes:     tatsächlich gewährte Scopes
 *   - type:       "public-api"
 *
 * Backwards-Compat: Wir verarbeiten JSON- und Form-Bodies identisch.
 */
@ApiTags('oauth')
@Controller('oauth')
export class OAuthController {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  @Post('token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'OAuth2 Token-Endpoint (client_credentials-Grant)',
    description:
      'Tauscht client_id + client_secret gegen einen JWT-Access-Token (1h TTL).',
  })
  @ApiResponse({
    status: 200,
    description: 'Token erfolgreich ausgestellt',
    type: OAuthTokenResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Ungültige Parameter oder grant_type',
  })
  @ApiResponse({
    status: 401,
    description: 'client_id oder client_secret ungültig',
  })
  async issueToken(
    @Body() dto: OAuthTokenRequestDto,
  ): Promise<OAuthTokenResponseDto> {
    const requestedScopes = dto.scope
      ? (dto.scope
          .split(/\s+/)
          .map((s) => asAPIScope(s))
          .filter((s): s is NonNullable<typeof s> => s !== null))
      : undefined;

    const result = await this.apiKeyService.issueToken({
      keyId: dto.client_id,
      secret: dto.client_secret,
      requestedScopes,
    });

    return {
      access_token: result.accessToken,
      token_type: 'Bearer',
      expires_in: result.expiresIn,
      scope: result.scopes.join(' '),
    };
  }
}