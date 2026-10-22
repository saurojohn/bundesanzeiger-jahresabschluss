import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { EncryptionService } from '../src/modules/auth/services/encryption.service';
import {
  entschluesseln,
  istVerschluesselt,
} from '../src/common/utils/verschluesseltes-geheimnis';

/**
 * Das HMAC-Secret einer Webhook-Subscription lag im Klartext in der
 * Datenbank.
 *
 * BEFUND 2026-10-22 (Nachtrag 82). **Gemessen** an der laufenden API:
 *
 *   POST /api/webhook-subscriptions
 *     {kanzleiId, url, events, secret: "MessSecretKlartext0123456789ABCDEFGH"}
 *   -> HTTP 201, `plaintextSecret` zurueckgegeben
 *
 *   SELECT secret FROM webhook_subscription
 *     -> MessSecretKlartext0123456789ABCDEFGH      (byteweise identisch)
 *     -> EppjYUVXlZbKiJgwWqsq8FLOifulwmB-         (servergeneriert, ebenfalls Klartext)
 *
 * Die Behauptung im DTO lautete: "Wird im Klartext gespeichert (nicht
 * hashen) — das Secret MUSS fuer HMAC-Signatur lesbar bleiben." Richtig ist:
 * hashen ist unmoeglich (der Server muss selbst signieren), VERSCHLUESSELN
 * nicht — "lesbar" ist nicht "entschluesselbar".
 *
 * Warum das mehr als Kosmetik ist: die Datenbank ist das aufbewahrungs-
 * pflichtige System (§ 146 / § 147 AO, GoBD). Ein Dump davon — Backup,
 * Restore, Leck — lieferte ein vollstaendiges HMAC-Secret. Damit liess sich
 * jede ausgehende Webhook-Nachricht faelschen; der Empfaenger haette eine
 * scheinbar gueltige Signatur gesehen.
 *
 * Gegenprobe (darf nicht wegfallen): das Secret muss weiterhin fuer die
 * HMAC-Signatur benutzbar sein. Ein Test, der nur "steht nicht im Klartext
 * drin" prueft, waere auch dann gruen, wenn das Secret kaputt waere.
 */
const BASE = 'http://localhost:3000';
const SECRET = 'MessSecretKlartext0123456789ABCDEFGH';

describe('Webhook-Secret: es liegt nicht im Klartext in der Datenbank (Nachtrag 82)', () => {
  const prisma = new PrismaClient();
  let kanzleiId = '';
  let token = '';
  let subId = '';

  const login = async (email: string) => {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'Demo123!' }),
    });
    const d = (await r.json()) as { accessToken: string };
    expect(d.accessToken, `Login ${email}`).toBeTruthy();
    return d.accessToken;
  };

  beforeAll(async () => {
    const kanzlei = await prisma.kanzlei.findFirstOrThrow({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    kanzleiId = kanzlei.id;
    token = await login('kanzlei-admin@kanzlei.de');
  });

  afterAll(async () => {
    if (subId) {
      await prisma.webhookSubscription.deleteMany({ where: { id: subId } });
    }
    await prisma.$disconnect();
  });

  it('legt das Secret verschluesselt ab und gibt es dem Client nur einmal zurueck', async () => {
    const res = await fetch(`${BASE}/api/webhook-subscriptions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        kanzleiId,
        url: 'https://hooks.example.com/banz',
        events: ['banz.submission.published'],
        secret: SECRET,
      }),
    });
    const text = await res.text();
    expect(res.status, `Antwort: ${text.slice(0, 200)}`).toBe(201);
    const body = JSON.parse(text) as {
      subscription: { id: string };
      plaintextSecret: string;
    };
    subId = body.subscription.id;

    // Der Client bekommt das Plaintext-Secret genau einmal — ohne das kann
    // er die Signatur nicht pruefen. Das ist die positive Gegenstueckseite.
    expect(body.plaintextSecret).toBe(SECRET);

    const row = await prisma.webhookSubscription.findUniqueOrThrow({
      where: { id: subId },
      select: { secret: true },
    });

    // 1) Die Zeile existiert und traegt einen Wert (kein "nichts gefunden",
    //    der gruen waere, weil die ganze Seite fehlt).
    expect(row.secret, 'die Zeile muss einen Secret-Wert haben').toBeTruthy();
    // 2) Er ist NICHT der Klartext.
    expect(row.secret, 'das Secret darf nicht im Klartext abgelegt sein').not.toBe(SECRET);
    // 3) Er ist als verschluesselt markiert.
    expect(istVerschluesselt(row.secret)).toBe(true);
    // 4) Und er ist genau DIES Secret — verschluesselt. Ohne diese Probe
    //    waere "irgendein Muell in der Spalte" auch gruen.
    const encryption = new EncryptionService(
      new ConfigService({ JWT_SECRET: process.env.JWT_SECRET }),
    );
    expect(entschluesseln(encryption, row.secret)).toBe(SECRET);
  });

  it('liefert das Secret nirgends aus — auch nicht im Audit-Eintrag', async () => {
    const list = await fetch(`${BASE}/api/webhook-subscriptions`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const listText = await list.text();
    expect(list.status).toBe(200);
    expect(listText, 'die Liste darf kein Secret enthalten').not.toContain(SECRET);

    const deliveries = await fetch(
      `${BASE}/api/webhook-subscriptions/${subId}/deliveries`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    const deliveryText = await deliveries.text();
    expect(deliveries.status).toBe(200);
    expect(deliveryText, 'die Delivery-History darf kein Secret enthalten').not.toContain(
      SECRET,
    );

    // Der Audit-Trail ist aufbewahrungspflichtig und wird mitgegeben. Ein
    // Secret darin waere ein zweiter Klartext-Speicher.
    const audit = await prisma.auditLog.findMany({
      where: { entityType: 'WebhookSubscription', entityId: subId },
      select: { newState: true, previousState: true },
    });
    expect(audit.length, 'die Anlage muss protokolliert sein').toBeGreaterThan(0);
    expect(
      JSON.stringify(audit),
      'der Audit-Eintrag darf kein Secret enthalten',
    ).not.toContain(SECRET);
  });
});
