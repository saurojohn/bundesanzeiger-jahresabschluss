import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AnhangService } from '../src/modules/anhang/services/anhang.service';
import type { AuthUser } from '../src/modules/auth/types/auth-user.types';

/**
 * Mandantentrennung **ohne** den HTTP-Guard.
 *
 * BEFUND 2026-10-20 (Nachtrag 58, TODO-8.7): Ueber HTTP entscheidet der
 * `MandantGuard` — die Pruefung im Service ist Tiefenschutz. Die Frage war
 * lange offen: *„Tiefenschutz oder toter Code?"*
 *
 * Die Antwort ist: **beides war es nicht** — es war **zwoelfmal derselbe
 * Code**. Und die eigentliche Luecke war eine andere: ueber HTTP war die
 * Service-Pruefung unerreichbar, also **wirkungslos**, und niemand wusste
 * das. Ein Tiefenschutz, von dem niemand weiss, dass er existiert, wird
 * beim Refaktorieren entfernt — und dann ist die Mandantentrennung
 * weg.
 *
 * Dieser Test beweist, dass die Pruefung **greift**, wenn der Guard
 * umgangen wird: der Service wird direkt aufgerufen, ohne HTTP, ohne
 * Guard.
 *
 * **Die Gegenprobe ist Pflicht:** derselbe Aufruf mit dem Mandanten, auf
 * dem der User zugreifen darf, darf **nicht** an der Zugriffspruefung
 * scheitern. Eine Pruefung, die alles abweist, waere genauso nutzlos wie
 * eine, die nichts abweist.
 */
describe('Mandantentrennung im Service (ohne HTTP-Guard)', () => {
  let prisma: PrismaService;
  let anhangService: AnhangService;
  /** Mandant, auf den der Test-User zugreifen darf. */
  let eigenerMandantId = '';
  /** Mandant, auf den er NICHT zugreifen darf. */
  let fremderMandantId = '';
  /** Ein beliebiger Anhang — der Inhalt ist fuer die Zugriffspruefung egal. */
  let anhangId = '';
  let user: AuthUser;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();
    anhangService = moduleRef.get(AnhangService);

    // Der GF-Demo-User hat Zugang zu **genau einem** Mandant ("Demo GmbH") —
    // damit ist der fremde Mandant wirklich fremd.
    const gf = await prisma.user.findFirst({
      where: { email: 'gf-demo@demo-gmbh.de' },
      include: { mandantRoles: true },
    });
    expect(gf, 'der Seed muss den GF-Demo-User anlegen').toBeTruthy();

    eigenerMandantId = gf!.mandantRoles[0]!.mandantId;

    const fremder = await prisma.mandant.findFirst({
      where: { id: { not: eigenerMandantId } },
      select: { id: true },
    });
    expect(fremder, 'es muss mindestens einen zweiten Mandanten geben').toBeTruthy();
    fremderMandantId = fremder!.id;

    const anhang = await prisma.anhang.findFirst({
      where: { mandantId: eigenerMandantId },
      select: { id: true },
    });
    expect(anhang, 'der Seed muss einen Anhang anlegen').toBeTruthy();
    anhangId = anhang!.id;

    user = {
      id: gf!.id,
      email: gf!.email,
      vorname: gf!.vorname,
      nachname: gf!.nachname,
      globalRole: 'USER',
      mandanten: gf!.mandantRoles.map((m) => ({
        id: m.mandantId,
        firmenname: '',
        rolle: m.rolle as AuthUser['mandanten'][number]['rolle'],
      })),
    };
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('weist den Zugriff auf einen fremden Mandanten ab — ohne HTTP, ohne Guard', async () => {
    let geworfen: unknown = null;
    try {
      await anhangService.findOne(anhangId, fremderMandantId, user);
    } catch (err) {
      geworfen = err;
    }

    expect(
      geworfen,
      'der Service muss einen fremden Mandanten auch ohne den HTTP-Guard abweisen',
    ).toBeInstanceOf(ForbiddenException);
    expect((geworfen as Error).message).toBe('Kein Zugriff auf diesen Mandanten');
  });

  it('lässt den Zugriff auf den eigenen Mandanten zu — die Gegenprobe', async () => {
    // Die Gegenprobe: dieselbe Pruefung, gleicher Mandant, fuer den der
    // User zustaendig ist. Sie darf hier NICHT anschlagen.
    //
    // Eine Pruefung, die alles abweist, waere genauso nutzlos wie eine, die
    // nichts abweist — und waere schwerer zu entdecken.
    let geworfen: unknown = null;
    let ergebnis: unknown = null;
    try {
      ergebnis = await anhangService.findOne(anhangId, eigenerMandantId, user);
    } catch (err) {
      geworfen = err;
    }

    expect(
      geworfen,
      'der eigene Mandant darf nicht an der Zugriffspruefung scheitern',
    ).not.toBeInstanceOf(ForbiddenException);
    expect(ergebnis, 'der Anhang muss geliefert werden').toBeTruthy();
  });
});
