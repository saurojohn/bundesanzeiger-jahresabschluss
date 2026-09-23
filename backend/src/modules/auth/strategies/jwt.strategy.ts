import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { GlobalRole } from '../constants/auth.constants';
import type { AuthUser, JwtAccessPayload } from '../types/auth-user.types';

/**
 * JWT-Access-Token-Strategie.
 *
 * Token wird aus dem Authorization-Header gelesen, Format: "Bearer <jwt>".
 * Secret: JWT_SECRET aus der Konfiguration.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(configService: ConfigService) {
    const secret = configService.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error('JWT_SECRET nicht konfiguriert');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
      algorithms: ['HS256'],
    });
  }

  /**
   * Wird von Passport nach erfolgreicher Token-Signature-Validierung
   * aufgerufen. Liefert das Objekt, das in `req.user` landet.
   */
  validate(payload: JwtAccessPayload): AuthUser {
    if (!payload?.sub || !payload.email) {
      throw new UnauthorizedException('Ungültiges Token-Payload');
    }
    return {
      id: payload.sub,
      email: payload.email,
      vorname: '',
      nachname: '',
      globalRole: (payload.globalRole as GlobalRole) ?? 'USER',
      mandanten: payload.mandanten ?? [],
    };
  }
}
