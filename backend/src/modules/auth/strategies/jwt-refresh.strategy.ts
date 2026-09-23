import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { JwtRefreshPayload } from '../types/auth-user.types';

/**
 * JWT-Refresh-Token-Strategie.
 *
 * Liest das Refresh-Token aus dem Body-Feld `refreshToken`. Verwendet
 * ein von JWT_SECRET abgeleitetes, separates Secret (Suffix "refresh"),
 * sodass Access- und Refresh-Tokens kryptografisch getrennt sind.
 */
@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(configService: ConfigService) {
    const baseSecret = configService.get<string>('JWT_SECRET');
    if (!baseSecret) {
      throw new Error('JWT_SECRET nicht konfiguriert');
    }
    super({
      jwtFromRequest: ExtractJwt.fromBodyField('refreshToken'),
      ignoreExpiration: false,
      secretOrKey: `${baseSecret}-refresh`,
      algorithms: ['HS256'],
      passReqToCallback: false,
    });
  }

  validate(payload: JwtRefreshPayload): { id: string; sessionId: string } {
    if (!payload?.sub || !payload.sessionId) {
      throw new UnauthorizedException('Ungültiges Refresh-Token-Payload');
    }
    return { id: payload.sub, sessionId: payload.sessionId };
  }
}
