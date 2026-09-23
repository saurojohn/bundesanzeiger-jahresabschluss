/**
 * Seed-Script.
 *
 * Legt Demo-Daten an:
 *   - 1 Kanzlei "Musterkanzlei Steuerberatung GmbH"
 *   - 3 Mandanten (Demo GmbH, Beispiel GmbH, Test AG)
 *   - 5 User (admin, kanzlei-admin, steuerberater, wp, gf-demo)
 *
 * Ausführung:
 *   npx prisma db seed
 *
 * Im Dev-Setup (kein DB): dieses Skript läuft erst NACH `prisma migrate dev`.
 */

import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const KANZLEI_NAME = 'Musterkanzlei Steuerberatung GmbH';
const MANDANT_DEMO = 'Demo GmbH';
const MANDANT_BEISPIEL = 'Beispiel GmbH';
const MANDANT_TEST_AG = 'Test AG';

async function main(): Promise<void> {
  console.log('[seed] Starting seed…');

  // Reset — defensive; idempotent nur wenn DB leer.
  await prisma.auditLog.deleteMany();
  await prisma.userSession.deleteMany();
  await prisma.userMandantRole.deleteMany();
  await prisma.user.deleteMany();
  await prisma.mandant.deleteMany();
  await prisma.kanzlei.deleteMany();

  // ----------------------------------------------------------------------------
  // Kanzlei
  // ----------------------------------------------------------------------------
  const kanzlei = await prisma.kanzlei.create({
    data: {
      name: KANZLEI_NAME,
      rechtsform: 'Steuerberatungsgesellschaft',
      adresse: {
        strasse: 'Kanzleistrasse 1',
        plz: '10117',
        ort: 'Berlin',
        land: 'DE',
      },
      ustId: 'DE123456789',
    },
  });
  console.log(`[seed] Kanzlei angelegt: ${kanzlei.name} (${kanzlei.id})`);

  // ----------------------------------------------------------------------------
  // Mandanten
  // ----------------------------------------------------------------------------
  const mandant1 = await prisma.mandant.create({
    data: {
      kanzleiId: kanzlei.id,
      firmenname: MANDANT_DEMO,
      rechtsform: 'GmbH',
      handelsregister: 'HRB 123456',
      ustId: 'DE111222333',
      adresse: {
        strasse: 'Demostrasse 12',
        plz: '20095',
        ort: 'Hamburg',
        land: 'DE',
      },
      geschaeftsfuehrer: [
        { name: 'Max Demo', geburtsdatum: '1970-05-15', anteilProzent: 100 },
      ],
      gruendungsdatum: new Date('2010-01-15'),
      bilanzsummeVorjahr: '150000.00',
      umsatzVorjahr: '400000.00',
      mitarbeiterAnzahl: 3,
      groessenklasse: 'KLEINST',
      publishChannel: 'PDF_DIRECT',
    },
  });

  const mandant2 = await prisma.mandant.create({
    data: {
      kanzleiId: kanzlei.id,
      firmenname: MANDANT_BEISPIEL,
      rechtsform: 'GmbH',
      handelsregister: 'HRB 234567',
      ustId: 'DE222333444',
      adresse: {
        strasse: 'Beispielweg 7',
        plz: '80331',
        ort: 'München',
        land: 'DE',
      },
      geschaeftsfuehrer: [
        { name: 'Erika Beispiel', geburtsdatum: '1980-08-22', anteilProzent: 60 },
        { name: 'Karl Beispiel', geburtsdatum: '1975-03-10', anteilProzent: 40 },
      ],
      gruendungsdatum: new Date('2005-06-30'),
      bilanzsummeVorjahr: '1500000.00',
      umsatzVorjahr: '3500000.00',
      mitarbeiterAnzahl: 25,
      groessenklasse: 'KLEIN',
      publishChannel: 'XML_XBRL',
    },
  });

  const mandant3 = await prisma.mandant.create({
    data: {
      kanzleiId: kanzlei.id,
      firmenname: MANDANT_TEST_AG,
      rechtsform: 'AG',
      handelsregister: 'HRB 345678',
      ustId: 'DE333444555',
      adresse: {
        strasse: 'Testallee 99',
        plz: '50667',
        ort: 'Köln',
        land: 'DE',
      },
      geschaeftsfuehrer: [
        { name: 'Anna Test', geburtsdatum: '1965-11-01', anteilProzent: 100 },
      ],
      gruendungsdatum: new Date('1998-04-12'),
      bilanzsummeVorjahr: '25000000.00',
      umsatzVorjahr: '80000000.00',
      mitarbeiterAnzahl: 350,
      groessenklasse: 'GROSS',
      publishChannel: 'EBILANZ_TAXONOMIE',
    },
  });
  console.log(
    `[seed] Mandanten angelegt: ${mandant1.firmenname}, ${mandant2.firmenname}, ${mandant3.firmenname}`,
  );

  // ----------------------------------------------------------------------------
  // User — Passwörter gehasht
  // ----------------------------------------------------------------------------
  const adminPwd = await bcrypt.hash('Admin123!', 12);
  const demoPwd = await bcrypt.hash('Demo123!', 12);

  const admin = await prisma.user.create({
    data: {
      email: 'admin@kanzlei.de',
      passwordHash: adminPwd,
      vorname: 'System',
      nachname: 'Administrator',
      kanzleiId: kanzlei.id,
      globalRole: 'SYSTEM_ADMIN',
      isActive: true,
    },
  });
  await prisma.userMandantRole.create({
    data: { userId: admin.id, mandantId: mandant1.id, rolle: 'KANZLEI_ADMIN' },
  });

  const kanzleiAdmin = await prisma.user.create({
    data: {
      email: 'kanzlei-admin@kanzlei.de',
      passwordHash: demoPwd,
      vorname: 'Klara',
      nachname: 'Kanzlei',
      kanzleiId: kanzlei.id,
      globalRole: 'USER',
      isActive: true,
    },
  });
  for (const m of [mandant1, mandant2, mandant3]) {
    await prisma.userMandantRole.create({
      data: { userId: kanzleiAdmin.id, mandantId: m.id, rolle: 'KANZLEI_ADMIN' },
    });
  }

  const steuerberater = await prisma.user.create({
    data: {
      email: 'steuerberater@kanzlei.de',
      passwordHash: demoPwd,
      vorname: 'Stefan',
      nachname: 'Steuer',
      kanzleiId: kanzlei.id,
      globalRole: 'USER',
      isActive: true,
    },
  });
  for (const m of [mandant1, mandant2, mandant3]) {
    await prisma.userMandantRole.create({
      data: { userId: steuerberater.id, mandantId: m.id, rolle: 'STEUERBERATER' },
    });
  }

  const wp = await prisma.user.create({
    data: {
      email: 'wp@kanzlei.de',
      passwordHash: demoPwd,
      vorname: 'Werner',
      nachname: 'Prüfer',
      kanzleiId: kanzlei.id,
      globalRole: 'USER',
      isActive: true,
    },
  });
  for (const m of [mandant1, mandant2]) {
    await prisma.userMandantRole.create({
      data: { userId: wp.id, mandantId: m.id, rolle: 'WIRTSCHAFTSPRUEFER' },
    });
  }

  const gfDemo = await prisma.user.create({
    data: {
      email: 'gf-demo@demo-gmbh.de',
      passwordHash: demoPwd,
      vorname: 'Max',
      nachname: 'Demo',
      kanzleiId: kanzlei.id,
      globalRole: 'USER',
      isActive: true,
    },
  });
  await prisma.userMandantRole.create({
    data: { userId: gfDemo.id, mandantId: mandant1.id, rolle: 'GF' },
  });

  console.log(
    `[seed] User angelegt: ${admin.email}, ${kanzleiAdmin.email}, ${steuerberater.email}, ${wp.email}, ${gfDemo.email}`,
  );

  console.log('[seed] Done.');
}

main()
  .catch((e: unknown) => {
    console.error('[seed] Fehler:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
