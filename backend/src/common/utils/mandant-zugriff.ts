import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from '../../modules/auth/types/auth-user.types';

/**
 * Mandantenzugriff — Tiefenschutz.
 *
 * ## Wozu das gut ist (und wozu nicht)
 *
 * Ueber HTTP ist diese Pruefung **nicht** die, die entscheidet: der globale
 * `MandantGuard` wirkt zuerst und lehnt einen fremden Mandanten mit
 * "Kein Zugriff auf diesen Mandanten" ab — noch bevor der Service
 * erreicht wird (Nachtrag 34).
 *
 * Die Pruefung hier ist damit **Tiefenschutz**: sie greift, wenn ein
 * Mandant ohne Guard erreicht wird — etwa ueber einen internen Aufruf, einen
 * Job, oder wenn der Guard spaeter umgebaut wird. Sie ersetzt den Guard
 * nicht; sie ist die zweite Schranke.
 *
 * BEFUND 2026-10-20 (Nachtrag 58, TODO-8.7): Die Pruefung stand
 * **zwoelfmal** im Quelltext — als private Methode in zwoelf Services,
 * jeweils mit derselben Logik und derselben Fehlermeldung. Jede Kopie war
 * eine Gelegenheit, eine davon zu aendern und die anderen zu vergessen.
 * Genau das ist mit `assertMandantAccess` in `mandant.service.ts` passiert:
 * dort stand `BadRequestException` (400) statt `ForbiddenException` (403) —
 * der Unterschied zwischen "deine Anfrage ist falsch" und "du darfst das
 * nicht".
 *
 * **Eine Kopie statt zwoelf.** Der Aufrufer ruft diese Funktion; die
 * Fehlermeldung ist damit an genau einer Stelle definiert.
 *
 * **Achtung, `mandant.service.ts`:** dort ist die Pruefung *anders* — sie
 * laesst einen KANZLEI_ADMIN auch auf einen Mandanten derselben Kanzlei
 * zugreifen und prueft das ueber die Datenbank. Sie bleibt dort, weil sie
 * etwas anderes beantwortet. Diese Funktion ist die einfache Variante.
 */
export function assertMandantAccess(mandantId: string, user: AuthUser): void {
  if (user.globalRole === 'SYSTEM_ADMIN') return;
  const erreichbar = (user.mandanten ?? []).some((m) => m.id === mandantId);
  if (erreichbar) return;
  throw new ForbiddenException('Kein Zugriff auf diesen Mandanten');
}
