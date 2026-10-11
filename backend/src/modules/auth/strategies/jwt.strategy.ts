import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../prisma/prisma.service';
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
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
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
   *
   * BEFUND 2026-10-11 — es gab hier KEINE Datenbankabfrage. Damit war
   * `User.isActive` ein totes Feld: es stand im Schema, wurde aber
   * nirgends ausgewertet. Ein deaktiviertes Konto arbeite weiter, bis
   * das Access-Token ablaeuft. Ebenso fand keine Pruefung auf entzogene
   * Mandant-Rollen statt (`UserMandantRole.revokedAt`).
   *
   * Ab jetzt wird `isActive` live geprueft — **fail-closed**:
   *
   *  - User nicht gefunden            -> 401
   *  - `isActive === false`           -> 401
   *  - Datenbank nicht erreichbar     -> 401
   *
   * Der letzte Punkt ist der teure: ein DB-Ausfall sperrt das System.
   * Das ist Absicht. Ein Ausfall, der Zugriff erlaubt, waere genau die
   * Klasse von Fehler, die dieses Audit bisher gefunden hat — die
   * Kontrolle darf nicht davon abhaengen, dass alles glueckt.
   *
   * KOSTEN: eine indizierte Abfrage je authentifiziertem Request. Bei der
   * Groessenordnung des Pilots (Kanzlei, einige Dutzend Mandanten) nicht
   * messbar gegen den Nutzen.
   *
   * WAS BEWUSST UNVERAENDERT BLEIBT: die Mandant-Rollen kommen weiterhin
   * aus dem Token-Snapshot. Ein Rollenentzug wirkt damit bis zum
   * Token-Ablauf (`JWT_ACCESS_TOKEN_TTL`, Default 15 min), nicht sofort.
   * Das ist eine bewusste Abwaegung zwischen Latenz und Konsistenz und
   * KEIN Fehler — im Gegensatz zu `isActive`, wo das Schema eine Kontrolle
   * versprach, die es nicht gab.
   *
   * Ebenso gilt: `logout` entzieht den Refresh-Token. Ein bereits
   * ausgestelltes Access-Token bleibt bis zum Ablauf gueltig. Das ist
   * uebliches OAuth-Verhalten und wird hier nicht kaschiert, sondern
   * benannt.
   */
  async validate(payload: JwtAccessPayload): Promise<AuthUser> {
    if (!payload?.sub || !payload.email) {
      throw new UnauthorizedException('Ungültiges Token-Payload');
    }

    let isActive: boolean;
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { isActive: true },
      });
      if (!user) {
        // Unbekannte `sub` bei gueltiger Signatur: das Token wurde mit
        // unserem Secret erzeugt, der User existiert aber nicht mehr.
        throw new UnauthorizedException('Benutzer nicht gefunden');
      }
      isActive = user.isActive;
    } catch (fehler) {
      if (fehler instanceof UnauthorizedException) throw fehler;
      // fail-closed: bei DB-Fehler wird verweigert, nicht erlaubt.
      throw new UnauthorizedException('Konto-Status nicht prüfbar');
    }

    if (!isActive) {
      throw new UnauthorizedException('Benutzerkonto ist deaktiviert');
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