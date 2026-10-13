import { describe, it, expect, vi } from 'vitest';
import { WormObjectRepository } from './worm-object.repository';
import { SignatureRepository } from '../../../common/repositories/signature.repository';

/**
 * BEFUND 2026-10-11 — Der Signaturpfad war nicht atomar.
 *
 * WORM-Manifest und Signature-Record wurden in zwei unabhängigen Schritten
 * geschrieben. Ein Fehler im zweiten ließ ein revisionssicher archiviertes,
 * signiertes PDF ohne Signatur-Datensatz zurück — und der Audit-Eintrag
 * hinter dem Block wurde nie erreicht. Die Signatur fand statt und
 * hinterließ keinen nachprüfbaren Beleg.
 *
 * Der S3-Write selbst kann nicht transaktional sein (kein Two-Phase-Commit).
 * Ein verwaister Objekt-Eintrag ist harmlos und mit `legalHold` sogar
 * erwünscht; ein fehlender Signatur-Datensatz nicht.
 *
 * Der Test prüft die Verkabelung: BEIDE Schreibvorgänge müssen über den
 * übergebenen Client laufen. Ein Test, der nur prüft „es wurde
 * geschrieben", sähe keinen Unterschied.
 */

const EINGABE = {
  objectKey: 'mandant/m/bilanz-signed/2026/abc.pdf',
  entityType: 'BILANZ_PDF_SIGNED',
  entityId: 'e1',
  mandantId: 'm1',
  sha256Hash: 'a'.repeat(64),
  sizeBytes: 100,
  objectLockMode: 'COMPLIANCE',
  retentionDays: 3650,
  retentionExpiresAt: new Date('2036-01-01'),
  uploadedById: 'u1',
  legalHold: true,
};

const SIGNATUR_EINGABE = {
  // Seit 2026-10-13 Pflicht: die ID, unter der gespeichert wird. Ohne sie
  // vergaeb Prisma eine eigene, und die `signatureId` aus der API-Antwort
  // war ein toter Verweis.
  id: 's1',
  jahresabschlussId: 'j1',
  userId: 'u1',
  rolle: 'WIRTSCHAFTSPRUEFER',
  signaturTyp: 'QUALIFIZIERT',
  zertifikatSubject: 'CN=Test',
  zertifikatIssuer: 'CN=CA',
  zertifikatSeriennummer: '01',
  zertifikatGueltigAb: new Date('2026-01-01'),
  zertifikatGueltigBis: new Date('2030-01-01'),
  zeitstempel: new Date('2026-01-01'),
  zeitstempelIssuer: 'OHNE_TSA',
  hashVorher: 'b'.repeat(64),
  hashNachher: 'c'.repeat(64),
  signaturDaten: Buffer.from('sig'),
  signaturFormat: 'PKCS7',
};

/** Ein Client, der für jede Transaktion einen eigenen Marker zurückgibt. */
function txClient() {
  return {
    wormObject: { create: vi.fn().mockResolvedValue({ id: 'w1' }) },
    signature: { create: vi.fn().mockResolvedValue({ id: 's1' }) },
  } as never;
}

describe('BEFUND 2026-10-11: Signatur-Nebenwirkungen teilen eine Transaktion', () => {
  it('das WORM-Manifest geht über den übergebenen Client', async () => {
    const wormCreate = vi.fn().mockResolvedValue({ id: 'w1' });
    const prisma = { wormObject: { create: vi.fn() } };
    const repo = new WormObjectRepository(prisma as never);

    await repo.create(EINGABE, { wormObject: { create: wormCreate } } as never);

    expect(wormCreate).toHaveBeenCalled();
    // Der Haupt-Client darf NICHT benutzt werden — sonst entsteht genau die
    // zweite, unabhängige Transaktion.
    expect(prisma.wormObject.create).not.toHaveBeenCalled();
  });

  it('der Signature-Record geht über denselben Client', async () => {
    const sigCreate = vi.fn().mockResolvedValue({ id: 's1' });
    const prisma = { signature: { create: vi.fn() } };
    const repo = new SignatureRepository(prisma as never);

    await repo.create(SIGNATUR_EINGABE, { signature: { create: sigCreate } } as never);

    expect(sigCreate).toHaveBeenCalled();
    expect(prisma.signature.create).not.toHaveBeenCalled();
  });

  it('ohne Client bleibt das bisherige Verhalten (eigene Transaktion)', () => {
    // Gegenprobe zur Abgrenzung: der Aufrufer darf nicht gezwungen werden.
    // Repositories werden auch ohne Transaktionsclient genutzt.
    const wormCreate = vi.fn().mockResolvedValue({ id: 'w1' });
    const repo = new WormObjectRepository({ wormObject: { create: wormCreate } } as never);

    return expect(repo.create(EINGABE)).resolves.toBeDefined();
  });

  it('beide Schreibvorgänge teilen sich denselben Client-Objekt', async () => {
    // Der eigentliche Nachweis der Atomaritaet: nicht "beide werden
    // geschrieben", sondern "beide im selben Client".
    const tx = txClient();
    const wormRepo = new WormObjectRepository({ wormObject: { create: vi.fn() } } as never);
    const sigRepo = new SignatureRepository({ signature: { create: vi.fn() } } as never);

    await wormRepo.create(EINGABE, tx);
    await sigRepo.create(SIGNATUR_EINGABE, tx);

    const alsTx = tx as unknown as {
      wormObject: { create: ReturnType<typeof vi.fn> };
      signature: { create: ReturnType<typeof vi.fn> };
    };
    expect(alsTx.wormObject.create).toHaveBeenCalledTimes(1);
    expect(alsTx.signature.create).toHaveBeenCalledTimes(1);
  });

  it('ein Fehler im zweiten Schritt erreicht den Aufrufer (⇒ Rollback)', async () => {
    // Der ROLLBACK ist Zusicherung von Prisma, nicht von diesem Code. Was
    // dieser Code zusichern muss: der Fehler wird NICHT geschluckt. Ein
    // `catch` hier wuerde die Transaktion zur Erfolgsmeldung machen.
    const tx = txClient();
    const sigRepo = new SignatureRepository({ signature: { create: vi.fn() } } as never);

    const fehler = new Error('Signature-Record nicht schreibbar');
    (tx as unknown as { signature: { create: ReturnType<typeof vi.fn> } }).signature.create.mockRejectedValue(
      fehler,
    );

    await expect(sigRepo.create(SIGNATUR_EINGABE, tx)).rejects.toThrow('nicht schreibbar');
  });
});