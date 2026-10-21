import type { PrismaClient } from '@prisma/client';

/**
 * Abweichung zwischen den Daten und der **signierten Fassung**.
 *
 * BEFUND 2026-10-21 (Nachträge 77/78): Der Jahresabschluss ist ein
 * Aggregat — die signierte Fassung ist ein PDF ueber Bilanz + GuV + Anhang.
 * Ob die vorgelegten Daten noch der signierten Fassung entsprechen, laesst
 * sich deshalb nur an den **Bestandteilen** ablesen.
 *
 * Zwei Fehler standen nebeneinander:
 *
 * 1. **Falschpositiv.** Gemessen wurde der eigene `updatedAt` des
 *    Jahresabschlusses — aber die Signatur setzt selbst den Status auf
 *    `SIGNED`, und dieser Schreibvorgang liegt nach dem Anlegen des
 *    Signaturdatensatzes. Der Vergleich war damit bei **jedem** signierten
 *    Jahresabschluss wahr ("ABWEICHEND"), ohne dass eine einzige Zahl
 *    geaendert wurde. Ein dauerhaft roter Indikator traegt keine
 *    Information: eine echte Abweichung fiel nicht mehr auf.
 *
 * 2. **Falschnegativ.** Eine Aenderung an einem Bestandteil bewegt den
 *    `updatedAt` des Jahresabschlusses nicht — sie war am Abschluss
 *    unsichtbar.
 *
 * **Die Regel:** geprueft wird der juengste Aenderungszeitpunkt der
 * Bestandteile gegen die juengste **Abschluss**-Signatur (eine
 * Bestandteil-Signatur bescheinigt nur einen Bestandteil — Nachtrag 60).
 *
 * Diese Datei ist die einzige Stelle, die die Frage beantwortet. Der
 * Signatur-Service nutzt sie fuer den Indikator, der Abschluss-Service fuer
 * die Einreichungssperre — zwei Aufrufer, eine Berechnung.
 */

/** Nur die Prisma-Tabellen, die die Pruefung braucht (testbar). */
export type AbweichungPrisma = Pick<
  PrismaClient,
  'signature' | 'bilanz' | 'guV' | 'anhang' | 'jahresabschluss'
>;

export interface AbweichungPruefung {
  /** true = die Daten wurden nach der Signatur geaendert. */
  abweichend: boolean;
  /** Die juengste Abschluss-Signatur (null = nie signiert). */
  signaturId: string | null;
  signiertAm: Date | null;
  /** Der juengste Aenderungszeitpunkt der Bestandteile. */
  geaendertAm: Date | null;
}

/**
 * Der juengste Aenderungszeitpunkt der Bestandteile eines Jahresabschlusses.
 *
 * @param abschlussIds die Verweise des Abschlusses auf Bilanz/GuV/Anhang
 */
export async function ladeBestandteilZeitpunkt(
  prisma: AbweichungPrisma,
  mandantId: string,
  abschlussIds: {
    bilanzId: string | null;
    guvId: string | null;
    anhangId: string | null;
  },
): Promise<Date | null> {
  const zeiten = await Promise.all([
    abschlussIds.bilanzId
      ? prisma.bilanz.findFirst({
          where: { id: abschlussIds.bilanzId, mandantId },
          select: { updatedAt: true },
        })
      : null,
    abschlussIds.guvId
      ? prisma.guV.findFirst({
          where: { id: abschlussIds.guvId, mandantId },
          select: { updatedAt: true },
        })
      : null,
    abschlussIds.anhangId
      ? prisma.anhang.findFirst({
          where: { id: abschlussIds.anhangId, mandantId },
          select: { updatedAt: true },
        })
      : null,
  ]);
  const stamps = zeiten
    .filter((z): z is { updatedAt: Date } => z !== null)
    .map((z) => z.updatedAt.getTime());
  if (stamps.length === 0) return null;
  return new Date(Math.max(...stamps));
}

/**
 * Weichen die Daten von der signierten Fassung ab?
 *
 * Ohne Signatur gibt es nichts, wovon abzuweichen waere.
 */
export function istAbweichend(
  signaturZeitpunkt: Date | null,
  geaendertAm: Date | null,
): boolean {
  if (signaturZeitpunkt === null) return false;
  if (geaendertAm === null) return false;
  return geaendertAm.getTime() > signaturZeitpunkt.getTime();
}

/**
 * Die vollstaendige Pruefung fuer einen Jahresabschluss.
 *
 * Genutzt von der Einreichung (fail-closed: eine abweichende Fassung wird
 * nicht eingereicht) und vom Signatur-Indikator (sichtbar: der Nutzer
 * sieht, dass die Daten von der signierten Fassung abweichen).
 */
export async function pruefeAbschlussAbweichung(
  prisma: AbweichungPrisma,
  mandantId: string,
  abschlussId: string,
): Promise<AbweichungPruefung> {
  const leer: AbweichungPruefung = {
    abweichend: false,
    signaturId: null,
    signiertAm: null,
    geaendertAm: null,
  };

  const abschluss = await prisma.jahresabschluss.findFirst({
    where: { id: abschlussId, mandantId },
    select: { bilanzId: true, guvId: true, anhangId: true },
  });
  if (!abschluss) return leer;

  // Die juengste **Abschluss**-Signatur. Eine Bestandteil-Signatur
  // bescheinigt nur einen Bestandteil (Nachtrag 60) und deckt den Abschluss
  // nicht ab.
  const signatur = await prisma.signature.findFirst({
    where: { jahresabschlussId: abschlussId, signaturEbene: 'ABSCHLUSS' },
    orderBy: { createdAt: 'desc' },
    select: { id: true, createdAt: true },
  });
  if (!signatur) return leer;

  const geaendertAm = await ladeBestandteilZeitpunkt(prisma, mandantId, abschluss);

  return {
    abweichend: istAbweichend(signatur.createdAt, geaendertAm),
    signaturId: signatur.id,
    signiertAm: signatur.createdAt,
    geaendertAm,
  };
}
