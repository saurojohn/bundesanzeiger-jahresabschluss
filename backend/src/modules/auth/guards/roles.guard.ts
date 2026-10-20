import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ROLES_KEY, type MandantRole } from '../constants/auth.constants';
import type { AuthUser } from '../types/auth-user.types';
import type { AnyRole } from '../decorators/roles.decorator';
import { ermittleMandantId } from '../../../common/utils/mandant-kontext';

/**
 * RBAC-Guard.
 *
 * Wenn ein Endpoint ohne @Roles() dekoriert ist, lässt der Guard
 * jeden authentifizierten User passieren (permissive default).
 *
 * SYSTEM_ADMIN umgeht die Prüfung (globale Admin-Permissions).
 *
 * ## BEFUND 2026-10-17 (Nachtrag 40): Die Rolle galt mandantenübergreifend
 *
 * Vorher stand hier:
 *
 *     const userMandantRoles = user.mandanten.flatMap((m) => m.rolle);
 *     const hasRole = requiredRoles.some((r) => userMandantRoles.includes(r));
 *
 * **Alle** Rollen des Users aus **allen** Mandanten wurden zusammengeworfen.
 * Das Datenmodell ist das Gegenteil: `UserMandantRole` hat eine
 * `mandantId`, und `@@unique([userId, mandantId, rolle])` — die Rolle
 * gehört zu einem Mandanten. Der Guard hat aus einer mandantenbezogenen
 * Rolle eine globale gemacht.
 *
 * Gemessen über die öffentliche API. Ein User mit
 *
 *     Beispiel GmbH → STEUERBERATER
 *     Beispiel GmbH → WIRTSCHAFTSPRUEFER     ← hier ist er WP
 *     Demo GmbH    → STEUERBERATER
 *     Test AG      → STEUERBERATER
 *
 * konnte `POST /api/signatur/sign-bilanz` für **Test AG** aufrufen und
 * erhielt 200 mit einer echten `signatureId`:
 *
 *     POST /api/signatur/sign-bilanz?mandantId=<Test AG>
 *     HTTP 200  {"signatureId":"3ffa4b82-…"}
 *
 * Er ist auf Test AG **nicht** Wirtschaftsprüfer. Damit greift die
 * Vier-Augen-Kontrolle für diesen Mandanten nicht: eine qeS ist eine
 * **Bescheinigung**, und sie wurde von jemandem abgegeben, der für den
 * Mandanten nicht bescheinigen darf. Für einen Mandantenbestand mit
 * gemischten Rollen — WP beim einen Mandanten, Berater beim anderen — war
 * die Kontrolle strukturell nicht vorhanden.
 *
 * ## Die Regel jetzt
 *
 * Ist ein Mandanten-Kontext ermittelbar (`x-mandant-id`, `?mandantId`,
 * Body oder Pfad — dieselbe Auflösung wie `MandantGuard`, siehe
 * `common/utils/mandant-kontext`), wird **nur die Rolle dieses Mandanten**
 * geprüft.
 *
 * Ist **kein** Mandant ermittelbar, gilt das alte, mandantenübergreifende
 * Verhalten weiter — dann handelt es sich um eine kanzlei-weite Route
 * (Branding, API-Keys, Mandantenverwaltung), auf der es keinen
 * Mandantenbezug gibt, auf den man die Rolle einschränken könnte. Diese
 * Routen verhalten sich unverändert.
 *
 * **Warum kein „nur bei WIRTSCHAFTSPRUEFER"**: Eine Ausnahme für genau
 * diese Rolle wäre der gemessene Fall, aber nicht die Ursache. Die Ursache
 * ist die Verwechslung von mandantenbezogener und globaler Rolle; sie
 * betrifft jede Rollenprüfung gleichermaßen.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<AnyRole[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles || requiredRoles === undefined || requiredRoles.length === 0) {
      return true;
    }

    // `Request` allein typisiert `user` als Express-`User`; der JWT
    // hinterlegt dort aber den `AuthUser`.
    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const user: AuthUser | undefined = req.user;
    if (!user) {
      throw new ForbiddenException('Nicht authentifiziert');
    }
    if (user.globalRole === 'SYSTEM_ADMIN') return true;

    // Mandantenbezogene Rolle, wenn ein Mandant adressiert ist.
    //
    // ACHTUNG — **alle** Eintraege sammeln, nicht den ersten nehmen:
    // `UserMandantRole` hat `@@unique([userId, mandantId, rolle])`, ein
    // User kann also **mehrere** Rollen auf demselben Mandanten haben. Im
    // JWT steht dann mehrfach dieselbe mandantId:
    //
    //     [ { Beispiel GmbH, STEUERBERATER },
    //       { Beispiel GmbH, WIRTSCHAFTSPRUEFER },
    //       { Demo GmbH,    STEUERBERATER } ]
    //
    // `user.mandanten.find(m => m.id === mandantId)` liefert hier nur die
    // erste und damit die falsche Rolle — ein WP wuerde als STEUERBERATER
    // durchgehen und bekäme 403. Gefunden durch die Gegenprobe im Nachtrag
    // 40: "auf dem Mandanten, für den die Rolle gilt, bleibt es erlaubt".
    const mandantId = ermittleMandantId(req);
    const zugewiesen = mandantId !== null && user.mandanten.some((m) => m.id === mandantId);

    // Ist der User diesem Mandanten ueberhaupt nicht zugewiesen, ist das ein
    // **Zugriffs-** und kein Rollenproblem. Der `RolesGuard` laeuft als
    // globaler `APP_GUARD` vor dem `MandantGuard`; beantwortet er diese
    // Faelle selbst, meldet er „Rolle fehlt für diesen Mandanten", obwohl
    // der User nie Zugriff hatte. Die richtige und weiterhin bestehende
    // Meldung ist die des `MandantGuard`: „Kein Zugriff auf diesen Mandanten".
    //
    // (Gemessen: `mandant-quelle.e2e.spec.ts` — "PATCH mit Header einer
    // fremden mandantId -> 403 'Kein Zugriff'" lieferte nach der ersten
    // Fassung die Rollenmeldung. Der Status war richtig, die Meldung nicht.)
    //
    // BEFUND 2026-10-21 (Nachtrag 70): Die Annahme „der `MandantGuard`
    // entscheidet" gilt **nicht fuer jede Route**. `PATCH/DELETE /api/mandant/:id`
    // und die Archivierungsrouten tragen **keinen** `MandantGuard` — dort
    // entscheidet der Service (`assertMandantAccess`). Der Service prueft
    // die KANZLEI-Zustaendigkeit jetzt ueber die Admin-Kanzlei-Bindung
    // (nicht ueber die Kanzlei des ersten Mandanten).
    //
    // Der Kontext-Mandant ist fuer den Rollen-Vergleich nicht der
    // Ziel-Mandant: ein Client darf den Header auf einen beliebigen
    // Mandanten setzen. Deshalb ist die Header-Aufloesung hier nur der
    // *Vergleichsmaßstab*, nicht die Berechtigung selbst.
    if (!zugewiesen) {
      const userMandantRoles: MandantRole[] = user.mandanten.flatMap((m) => m.rolle);
      const hatIrgendeineRolle = requiredRoles.some(
        (r) =>
          r === user.globalRole ||
          (userMandantRoles as readonly string[]).includes(r as string),
      );
      if (!hatIrgendeineRolle) {
        throw new ForbiddenException(
          `Rolle fehlt. Erforderlich: ${requiredRoles.join(', ')}`,
        );
      }
      // Rolle vorhanden, aber dieser Mandant nicht: der `MandantGuard`
      // entscheidet und sagt „Kein Zugriff".
      return true;
    }

    const rollenDesMandanten: string[] =
      user.mandanten
        .filter((m) => m.id === mandantId)
        .flatMap((m) => (Array.isArray(m.rolle) ? m.rolle : [m.rolle]));

    if (rollenDesMandanten.some((r) => (requiredRoles as readonly string[]).includes(r))) {
      return true;
    }

    // Der globale Vektor bleibt für kanzlei-weite Routen (kein
    // Mandantenkontext) und für die globale Rolle des Users.
    const userMandantRoles: MandantRole[] = user.mandanten.flatMap((m) => m.rolle);
    const hatIrgendeineRolle = requiredRoles.some(
      (r) =>
        r === user.globalRole ||
        (userMandantRoles as readonly string[]).includes(r as string),
    );

    if (!hatIrgendeineRolle) {
      throw new ForbiddenException(
        `Rolle fehlt. Erforderlich: ${requiredRoles.join(', ')}`,
      );
    }

    // Der User hat die Rolle zwar irgendwo — aber nicht **hier**.
    if (mandantId !== null) {
      throw new ForbiddenException(
        `Rolle ${requiredRoles.join(' oder ')} fehlt für diesen Mandanten. ` +
          'Die Rolle gilt mandantenbezogen: eine Rolle aus einem anderen ' +
          'Mandanten berechtigt nicht, für diesen zu handeln.',
      );
    }
    return true;
  }
}
