import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

/**
 * Entwurfs-PDF: kein Object-Lock, eigener EntityType, eigener Prefix.
 *
 * BEFUND 2026-10-20 (Nachtrag 61, TODO-8.9): Vier PDF-Routen
 * (`pdf/{bilanz,guv,anhang,abschluss}/:id/generate`) legten ihr Ergebnis
 * **ohne jede Statuspruefung** im Beweis-Archiv ab — mit 10-Jahres-
 * Object-Lock COMPLIANCE. Das gilt auch fuer **Entwuerfe**.
 *
 * Fachlich ist das falsch: Ein Entwurf ist ein Arbeitsstand. Er wird
 * geaendert, verworfen, neu erzeugt. Unwiderruflich archiviert waere er
 * danach ein "Beweis" fuer einen Stand, den niemand freigegeben hat.
 *
 * ENTSCHEIDUNG 2026-10-20: Entwuerfe bekommen einen eigenen `entityType`,
 * einen eigenen Key-Praefix und **keinen** Object-Lock.
 *
 * Der Test prueft **beide** Seiten:
 *   1. das Manifest (die DB) — EntityType, Lock-Modus, Retention, LegalHold
 *   2. das **S3-Objekt selbst** (HEAD gegen den Mock) — dort darf kein
 *      Object-Lock-Header stehen
 *
 * Die zweite Pruefung ist die wichtigere: eine DB-Zeile kann behaupten,
 * was sie will. Am Objekt im Speicher steht, ob es wirklich gesperrt ist.
 *
 * Und die **Gegenprobe**: eine abgeschlossene Bilanz (VALIDATED) geht
 * weiterhin unverwandt in das Beweis-Archiv.
 */

const BASE = 'http://localhost:3000';
const S3_ENDPOINT = process.env.S3_ENDPOINT ?? 'http://127.0.0.1:9000';
const S3_BUCKET = process.env.S3_BUCKET ?? 'banz-worm';
const JAHR = 2087;
const MANDANT = 'Demo GmbH';

interface LoginAntwort {
  accessToken: string;
  user: { mandanten: Array<{ id: string; firmenname: string }> };
}

describe('Entwurfs-PDF: kein Object-Lock (Nachtrag 61, TODO-8.9)', () => {
  const prisma = new PrismaClient();
  let token = '';
  let mid = '';

  beforeAll(async () => {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'steuerberater@kanzlei.de', password: 'Demo123!' }),
    });
    expect(r.status, 'Login').toBe(200);
    const login = (await r.json()) as LoginAntwort;
    token = login.accessToken;
    mid = login.user.mandanten.find((m) => m.firmenname === MANDANT)?.id ?? '';
    expect(mid, `${MANDANT} muss erreichbar sein`).not.toBe('');
    await aufraeumen();
  });

  afterAll(async () => {
    await aufraeumen();
    await prisma.$disconnect();
  });

  async function aufraeumen(): Promise<void> {
    await prisma.wormObject.deleteMany({ where: { mandantId: mid } });
    await prisma.bilanz.deleteMany({ where: { mandantId: mid, geschaeftsjahr: JAHR } });
  }

  function headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'x-mandant-id': mid,
    };
  }

  /** Legt eine Bilanz an und liefert ihre ID. */
  async function bilanzAnlegen(): Promise<string> {
    const r = await fetch(`${BASE}/api/bilanz?mandantId=${mid}`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        mandantId: mid,
        geschaeftsjahr: JAHR,
        positionen: [
          { seite: 'AKTIVA', kontonummer: 'B.IV.', bezeichnung: 'Kasse', betragAktuell: 1000, reihenfolge: 1 },
          { seite: 'PASSIVA', kontonummer: 'A.I.', bezeichnung: 'Kapital', betragAktuell: 1000, reihenfolge: 1 },
        ],
      }),
    });
    expect(r.status, 'Bilanz anlegen').toBe(201);
    const body = (await r.json()) as { bilanz: { id: string } };
    return body.bilanz.id;
  }

  async function pdfErzeugen(bilanzId: string): Promise<{ wormObjectKey: string; istEntwurf?: boolean }> {
    const r = await fetch(`${BASE}/api/pdf/bilanz/${bilanzId}/generate?mandantId=${mid}`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ mandantId: mid }),
    });
    const text = await r.text();
    expect(r.status, `PDF erzeugen: ${text.slice(0, 200)}`).toBe(200);
    return JSON.parse(text) as { wormObjectKey: string; istEntwurf?: boolean };
  }

  /**
   * HEAD gegen das Objekt im Speicher.
   *
   * Der Mock (`s3-mock/server.js`) gibt die Object-Lock-Header nur zurueck,
   * wenn das Objekt **mit** ihnen abgelegt wurde. Fehlen sie, war das
   * Objekt nicht gesperrt — unabhaengig von dem, was die DB behauptet.
   */
  async function objectLockAmObjekt(objectKey: string): Promise<{
    lockMode: string | null;
    retainUntil: string | null;
    legalHold: string | null;
  }> {
    const r = await fetch(`${S3_ENDPOINT}/${S3_BUCKET}/${objectKey}`, {
      method: 'HEAD',
    });
    expect(r.status, `HEAD ${objectKey}`).toBe(200);
    return {
      lockMode: r.headers.get('x-amz-object-lock-mode'),
      retainUntil: r.headers.get('x-amz-object-lock-retain-until-date'),
      legalHold: r.headers.get('x-amz-object-lock-legal-hold'),
    };
  }

  it('eine Bilanz auf DRAFT: eigener EntityType, eigener Prefix, KEIN Object-Lock', async () => {
    await aufraeumen();
    const bilanzId = await bilanzAnlegen();
    // Die neue Bilanz steht auf DRAFT — das ist der Arbeitsstand.
    const status = await prisma.bilanz.findUnique({
      where: { id: bilanzId },
      select: { status: true },
    });
    expect(status!.status, 'die Fixture muss auf DRAFT stehen').toBe('DRAFT');

    const antwort = await pdfErzeugen(bilanzId);
    expect(antwort.istEntwurf, 'die Antwort muss sagen, dass es ein Entwurf ist').toBe(true);

    // --- 1) Das Manifest ---------------------------------------------------
    const manifest = await prisma.wormObject.findFirst({
      where: { mandantId: mid },
      orderBy: { uploadedAt: 'desc' },
    });
    expect(manifest, 'es muss einen Manifest-Eintrag geben').toBeTruthy();
    expect(
      manifest!.entityType,
      'ein Entwurf braucht einen eigenen EntityType — sonst ist er in ' +
        'einer Auswertung nicht als Entwurf erkennbar',
    ).toBe('BILANZ_PDF_ENTWURF');
    expect(
      manifest!.objectLockMode,
      'ein Entwurf darf keinen Object-Lock tragen',
    ).toBe('NONE');
    expect(manifest!.retentionDays, 'ein Entwurf hat nichts aufzubewahren').toBe(0);
    expect(manifest!.legalHold, 'ein Entwurf steht nicht unter Legal Hold').toBe(false);
    expect(
      manifest!.objectKey,
      'ein Entwurf braucht einen eigenen Key-Praefix',
    ).toMatch(/^entwuerfe\/mandant\//);

    // --- 2) Das Objekt im Speicher (der eigentliche Beweis) ---------------
    const amObjekt = await objectLockAmObjekt(manifest!.objectKey);
    expect(
      amObjekt.lockMode,
      'das Objekt im Speicher traegt einen Object-Lock — der Entwurf ist ' +
        'unwiderruflich archiviert',
    ).toBeNull();
    expect(amObjekt.retainUntil, 'auch kein Retain-Until').toBeNull();
    expect(amObjekt.legalHold, 'auch kein Legal Hold').toBeNull();
  });

  it('eine VALIDATED-Bilanz geht weiterhin unveraendert ins Beweis-Archiv', async () => {
    await aufraeumen();
    const bilanzId = await bilanzAnlegen();
    await prisma.bilanz.update({
      where: { id: bilanzId },
      data: { status: 'VALIDATED' },
    });

    const antwort = await pdfErzeugen(bilanzId);
    expect(antwort.istEntwurf, 'ein abgeschlossener Bestand ist kein Entwurf').toBe(false);

    const manifest = await prisma.wormObject.findFirst({
      where: { mandantId: mid },
      orderBy: { uploadedAt: 'desc' },
    });
    expect(manifest!.entityType, 'der EntityType bleibt unveraendert').toBe('BILANZ_PDF');
    expect(manifest!.objectLockMode, 'COMPLIANCE wie bisher').toBe('COMPLIANCE');
    expect(manifest!.retentionDays, '10 Jahre wie bisher').toBe(3650);
    expect(manifest!.legalHold, 'Legal Hold wie bisher').toBe(true);
    expect(manifest!.objectKey, 'der Key-Praefix bleibt unveraendert').toMatch(/^mandant\//);

    // Und am Objekt selbst: der Lock ist gesetzt.
    const amObjekt = await objectLockAmObjekt(manifest!.objectKey);
    expect(amObjekt.lockMode, 'das Beweisobjekt muss gesperrt sein').toBe('COMPLIANCE');
    expect(amObjekt.legalHold, 'und unter Legal Hold').toBe('ON');
  });

  it('der Download liefert auch den Entwurf aus', async () => {
    await aufraeumen();
    const bilanzId = await bilanzAnlegen();
    await pdfErzeugen(bilanzId);

    const r = await fetch(
      `${BASE}/api/pdf/bilanz/${bilanzId}/download?mandantId=${mid}`,
      { headers: { authorization: `Bearer ${token}`, 'x-mandant-id': mid } },
    );
    expect(r.status, 'der Entwurf muss herunterladbar sein').toBe(200);
    expect(r.headers.get('content-type')).toContain('application/pdf');
    // Und der Dateiname sagt "Entwurf" — er ist Teil der Ablage.
    expect(
      r.headers.get('content-disposition') ?? '',
      'der Dateiname muss den Entwurf kennzeichnen',
    ).toContain('entwurf');
  });
});
