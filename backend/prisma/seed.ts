/**
 * Seed-Script.
 *
 * Legt Demo-Daten an:
 *   - 1 Kanzlei "Musterkanzlei Steuerberatung GmbH"
 *   - 3 Mandanten (Demo GmbH, Beispiel GmbH, Test AG)
 *   - 5 User (admin, kanzlei-admin, steuerberater, wp, gf-demo)
 *   - 1 leere Bilanz (DRAFT, GJ 2025) für Demo GmbH
 *   - 1 leere GuV (GKV, DRAFT, GJ 2025) für Demo GmbH
 *   - 1 leerer Anhang (DRAFT, GJ 2025) für Demo GmbH
 *
 * Ausführung:
 *   npx prisma db seed
 *
 * Im Dev-Setup (kein DB): dieses Skript läuft erst NACH `prisma migrate dev`.
 */

import { PrismaClient, Prisma } from '@prisma/client';
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
  await prisma.anhangAbschnitt.deleteMany();
  await prisma.anhang.deleteMany();
  await prisma.guVPosition.deleteMany();
  await prisma.guV.deleteMany();
  await prisma.bilanzPosition.deleteMany();
  await prisma.bilanz.deleteMany();
  await prisma.wPNotiz.deleteMany();
  await prisma.bilanzPruefungsResult.deleteMany();
  await prisma.wPPruefungsAbschluss.deleteMany();
  await prisma.pruefungsRegel.deleteMany();
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

  // ----------------------------------------------------------------------------
  // Demo-Bilanz/GuV/Anhang für Mandant "Demo GmbH" (GJ 2025, DRAFT)
  // ----------------------------------------------------------------------------

  // HGB § 266 Bilanzschema (vereinfachtes Mapping auf SKR03-Kontonummern).
  const aktivaSeedPositionen: Prisma.BilanzPositionCreateManyInput[] = [
    { bilanzId: '', seite: 'AKTIVA', kontonummer: 'A.I.1.', bezeichnung: 'Selbst geschaffene gewerbliche Schutzrechte und ähnliche Rechte und Werte', betragVorjahr: '0.00', betragAktuell: '0.00', reihenfolge: 1 },
    { bilanzId: '', seite: 'AKTIVA', kontonummer: 'A.I.2.', bezeichnung: 'Entgeltlich erworbene Konzessionen, gewerbliche Schutzrechte', betragVorjahr: '0.00', betragAktuell: '0.00', reihenfolge: 2 },
    { bilanzId: '', seite: 'AKTIVA', kontonummer: 'A.I.3.', bezeichnung: 'Geschäfts- oder Firmenwert', betragVorjahr: '0.00', betragAktuell: '0.00', reihenfolge: 3 },
    { bilanzId: '', seite: 'AKTIVA', kontonummer: 'A.I.4.', bezeichnung: 'Geleistete Anzahlungen', betragVorjahr: '0.00', betragAktuell: '0.00', reihenfolge: 4 },
    { bilanzId: '', seite: 'AKTIVA', kontonummer: 'A.II.1.', bezeichnung: 'Grundstücke, grundstücksgleiche Rechte und Bauten', betragVorjahr: '0.00', betragAktuell: '0.00', reihenfolge: 5 },
    { bilanzId: '', seite: 'AKTIVA', kontonummer: 'A.II.2.', bezeichnung: 'Technische Anlagen und Maschinen', betragVorjahr: '0.00', betragAktuell: '0.00', reihenfolge: 6 },
    { bilanzId: '', seite: 'AKTIVA', kontonummer: 'A.II.3.', bezeichnung: 'Andere Anlagen, Betriebs- und Geschäftsausstattung', betragVorjahr: '0.00', betragAktuell: '0.00', reihenfolge: 7 },
    { bilanzId: '', seite: 'AKTIVA', kontonummer: 'A.II.4.', bezeichnung: 'Geleistete Anzahlungen und Anlagen im Bau', betragVorjahr: '0.00', betragAktuell: '0.00', reihenfolge: 8 },
    { bilanzId: '', seite: 'AKTIVA', kontonummer: 'A.III.1.', bezeichnung: 'Anteile an verbundenen Unternehmen', betragVorjahr: '0.00', betragAktuell: '0.00', reihenfolge: 9 },
    { bilanzId: '', seite: 'AKTIVA', kontonummer: 'A.III.2.', bezeichnung: 'Ausleihungen an verbundene Unternehmen', betragVorjahr: '0.00', betragAktuell: '0.00', reihenfolge: 10 },
    { bilanzId: '', seite: 'AKTIVA', kontonummer: 'A.III.3.', bezeichnung: 'Beteiligungen', betragVorjahr: '0.00', betragAktuell: '0.00', reihenfolge: 11 },
    { bilanzId: '', seite: 'AKTIVA', kontonummer: 'A.III.4.', bezeichnung: 'Ausleihungen an Unternehmen, mit denen Beteiligungsverhältnis besteht', betragVorjahr: '0.00', betragAktuell: '0.00', reihenfolge: 12 },
    { bilanzId: '', seite: 'AKTIVA', kontonummer: 'A.III.5.', bezeichnung: 'Wertpapiere des Anlagevermögens', betragVorjahr: '0.00', betragAktuell: '0.00', reihenfolge: 13 },
    { bilanzId: '', seite: 'AKTIVA', kontonummer: 'A.III.6.', bezeichnung: 'Sonstige Ausleihungen', betragVorjahr: '0.00', betragAktuell: '0.00', reihenfolge: 14 },
    { bilanzId: '', seite: 'AKTIVA', kontonummer: 'B.I.1.', bezeichnung: 'Roh-, Hilfs- und Betriebsstoffe', betragVorjahr: '0.00', betragAktuell: '0.00', reihenfolge: 15 },
    { bilanzId: '', seite: 'AKTIVA', kontonummer: 'B.I.2.', bezeichnung: 'Unfertige Erzeugnisse, unfertige Leistungen', betragVorjahr: '0.00', betragAktuell: '0.00', reihenfolge: 16 },
    { bilanzId: '', seite: 'AKTIVA', kontonummer: 'B.I.3.', bezeichnung: 'Fertige Erzeugnisse und Waren', betragVorjahr: '0.00', betragAktuell: '0.00', reihenfolge: 17 },
    { bilanzId: '', seite: 'AKTIVA', kontonummer: 'B.I.4.', bezeichnung: 'Geleistete Anzahlungen', betragVorjahr: '0.00', betragAktuell: '0.00', reihenfolge: 18 },
    { bilanzId: '', seite: 'AKTIVA', kontonummer: 'B.II.1.', bezeichnung: 'Forderungen aus Lieferungen und Leistungen', betragVorjahr: '0.00', betragAktuell: '0.00', reihenfolge: 19 },
    { bilanzId: '', seite: 'AKTIVA', kontonummer: 'B.II.2.', bezeichnung: 'Forderungen gegen verbundene Unternehmen', betragVorjahr: '0.00', betragAktuell: '0.00', reihenfolge: 20 },
    { bilanzId: '', seite: 'AKTIVA', kontonummer: 'B.II.3.', bezeichnung: 'Forderungen gegen Unternehmen, mit denen Beteiligungsverhältnis besteht', betragVorjahr: '0.00', betragAktuell: '0.00', reihenfolge: 21 },
    { bilanzId: '', seite: 'AKTIVA', kontonummer: 'B.II.4.', bezeichnung: 'Sonstige Vermögensgegenstände', betragVorjahr: '0.00', betragAktuell: '0.00', reihenfolge: 22 },
    { bilanzId: '', seite: 'AKTIVA', kontonummer: 'B.III.1.', bezeichnung: 'Anteile an verbundenen Unternehmen', betragVorjahr: '0.00', betragAktuell: '0.00', reihenfolge: 23 },
    { bilanzId: '', seite: 'AKTIVA', kontonummer: 'B.III.2.', bezeichnung: 'Sonstige Wertpapiere', betragVorjahr: '0.00', betragAktuell: '0.00', reihenfolge: 24 },
    { bilanzId: '', seite: 'AKTIVA', kontonummer: 'B.IV.', bezeichnung: 'Kassenbestand, Bundesbankguthaben, Guthaben bei Kreditinstituten', betragVorjahr: '150000.00', betragAktuell: '150000.00', reihenfolge: 25 },
    { bilanzId: '', seite: 'AKTIVA', kontonummer: 'C.', bezeichnung: 'Rechnungsabgrenzungsposten', betragVorjahr: '0.00', betragAktuell: '0.00', reihenfolge: 26 },
    { bilanzId: '', seite: 'AKTIVA', kontonummer: 'D.', bezeichnung: 'Aktive latente Steuern', betragVorjahr: '0.00', betragAktuell: '0.00', reihenfolge: 27 },
  ];

  const passivaSeedPositionen: Prisma.BilanzPositionCreateManyInput[] = [
    { bilanzId: '', seite: 'PASSIVA', kontonummer: 'A.I.', bezeichnung: 'Gezeichnetes Kapital', betragVorjahr: '25000.00', betragAktuell: '25000.00', reihenfolge: 1 },
    { bilanzId: '', seite: 'PASSIVA', kontonummer: 'A.II.', bezeichnung: 'Kapitalrücklage', betragVorjahr: '0.00', betragAktuell: '0.00', reihenfolge: 2 },
    { bilanzId: '', seite: 'PASSIVA', kontonummer: 'A.III.1.', bezeichnung: 'Gesetzliche Rücklage', betragVorjahr: '0.00', betragAktuell: '0.00', reihenfolge: 3 },
    { bilanzId: '', seite: 'PASSIVA', kontonummer: 'A.III.2.', bezeichnung: 'Rücklage für eigene Anteile', betragVorjahr: '0.00', betragAktuell: '0.00', reihenfolge: 4 },
    { bilanzId: '', seite: 'PASSIVA', kontonummer: 'A.III.3.', bezeichnung: 'Satzungsmäßige Rücklagen', betragVorjahr: '0.00', betragAktuell: '0.00', reihenfolge: 5 },
    { bilanzId: '', seite: 'PASSIVA', kontonummer: 'A.III.4.', bezeichnung: 'Andere Gewinnrücklagen', betragVorjahr: '0.00', betragAktuell: '0.00', reihenfolge: 6 },
    { bilanzId: '', seite: 'PASSIVA', kontonummer: 'A.IV.', bezeichnung: 'Gewinnvortrag/Verlustvortrag', betragVorjahr: '115000.00', betragAktuell: '115000.00', reihenfolge: 7 },
    { bilanzId: '', seite: 'PASSIVA', kontonummer: 'A.V.', bezeichnung: 'Jahresüberschuss/Jahresfehlbetrag', betragVorjahr: '0.00', betragAktuell: '0.00', reihenfolge: 8 },
    { bilanzId: '', seite: 'PASSIVA', kontonummer: 'B.1.', bezeichnung: 'Rückstellungen für Pensionen und ähnliche Verpflichtungen', betragVorjahr: '0.00', betragAktuell: '0.00', reihenfolge: 9 },
    { bilanzId: '', seite: 'PASSIVA', kontonummer: 'B.2.', bezeichnung: 'Steuerrückstellungen', betragVorjahr: '0.00', betragAktuell: '0.00', reihenfolge: 10 },
    { bilanzId: '', seite: 'PASSIVA', kontonummer: 'B.3.', bezeichnung: 'Sonstige Rückstellungen', betragVorjahr: '0.00', betragAktuell: '0.00', reihenfolge: 11 },
    { bilanzId: '', seite: 'PASSIVA', kontonummer: 'C.1.', bezeichnung: 'Anleihen', betragVorjahr: '0.00', betragAktuell: '0.00', reihenfolge: 12 },
    { bilanzId: '', seite: 'PASSIVA', kontonummer: 'C.2.', bezeichnung: 'Verbindlichkeiten gegenüber Kreditinstituten', betragVorjahr: '0.00', betragAktuell: '0.00', reihenfolge: 13 },
    { bilanzId: '', seite: 'PASSIVA', kontonummer: 'C.3.', bezeichnung: 'Erhaltene Anzahlungen auf Bestellungen', betragVorjahr: '0.00', betragAktuell: '0.00', reihenfolge: 14 },
    { bilanzId: '', seite: 'PASSIVA', kontonummer: 'C.4.', bezeichnung: 'Verbindlichkeiten aus Lieferungen und Leistungen', betragVorjahr: '10000.00', betragAktuell: '10000.00', reihenfolge: 15 },
    { bilanzId: '', seite: 'PASSIVA', kontonummer: 'C.5.', bezeichnung: 'Verbindlichkeiten aus Wechseln', betragVorjahr: '0.00', betragAktuell: '0.00', reihenfolge: 16 },
    { bilanzId: '', seite: 'PASSIVA', kontonummer: 'C.6.', bezeichnung: 'Verbindlichkeiten gegenüber verbundenen Unternehmen', betragVorjahr: '0.00', betragAktuell: '0.00', reihenfolge: 17 },
    { bilanzId: '', seite: 'PASSIVA', kontonummer: 'C.7.', bezeichnung: 'Verbindlichkeiten gegenüber Unternehmen, mit denen Beteiligungsverhältnis besteht', betragVorjahr: '0.00', betragAktuell: '0.00', reihenfolge: 18 },
    { bilanzId: '', seite: 'PASSIVA', kontonummer: 'C.8.', bezeichnung: 'Sonstige Verbindlichkeiten', betragVorjahr: '0.00', betragAktuell: '0.00', reihenfolge: 19 },
    { bilanzId: '', seite: 'PASSIVA', kontonummer: 'D.', bezeichnung: 'Rechnungsabgrenzungsposten', betragVorjahr: '0.00', betragAktuell: '0.00', reihenfolge: 20 },
    { bilanzId: '', seite: 'PASSIVA', kontonummer: 'E.', bezeichnung: 'Passive latente Steuern', betragVorjahr: '0.00', betragAktuell: '0.00', reihenfolge: 21 },
  ];

  const bilanz = await prisma.bilanz.create({
    data: {
      mandantId: mandant1.id,
      geschaeftsjahr: 2025,
      status: 'DRAFT',
      hinweise: 'Seed-Daten — bitte durch echte Buchhaltungsdaten ersetzen.',
      createdById: steuerberater.id,
      positionen: {
        create: [...aktivaSeedPositionen, ...passivaSeedPositionen],
      },
    },
  });
  console.log(`[seed] Bilanz angelegt für ${MANDANT_DEMO} GJ 2025 (${bilanz.id})`);

  // ----------------------------------------------------------------------------
  // Demo-GuV (GKV) für Demo GmbH
  // ----------------------------------------------------------------------------
  const guvSeedPositionen: Prisma.GuVPositionCreateManyInput[] = [
    { guvId: '', kontonummer: '1.', bezeichnung: 'Umsatzerlöse', kategorie: 'ERLOES', betragVorjahr: '400000.00', betragAktuell: '400000.00', reihenfolge: 1 },
    { guvId: '', kontonummer: '2.', bezeichnung: 'Bestandsveränderungen', kategorie: 'ERLOES', betragVorjahr: '0.00', betragAktuell: '0.00', reihenfolge: 2 },
    { guvId: '', kontonummer: '3.', bezeichnung: 'Andere aktivierte Eigenleistungen', kategorie: 'ERLOES', betragVorjahr: '0.00', betragAktuell: '0.00', reihenfolge: 3 },
    { guvId: '', kontonummer: '4.', bezeichnung: 'Sonstige betriebliche Erträge', kategorie: 'ERLOES', betragVorjahr: '0.00', betragAktuell: '0.00', reihenfolge: 4 },
    { guvId: '', kontonummer: '5a.', bezeichnung: 'Aufwendungen für Roh-, Hilfs- und Betriebsstoffe', kategorie: 'MATERIAL', betragVorjahr: '150000.00', betragAktuell: '150000.00', reihenfolge: 5 },
    { guvId: '', kontonummer: '5b.', bezeichnung: 'Aufwendungen für bezogene Leistungen', kategorie: 'MATERIAL', betragVorjahr: '0.00', betragAktuell: '0.00', reihenfolge: 6 },
    { guvId: '', kontonummer: '6a.', bezeichnung: 'Löhne und Gehälter', kategorie: 'PERSONAL', betragVorjahr: '120000.00', betragAktuell: '120000.00', reihenfolge: 7 },
    { guvId: '', kontonummer: '6b.', bezeichnung: 'Soziale Abgaben und Aufwendungen für Altersversorgung', kategorie: 'PERSONAL', betragVorjahr: '25000.00', betragAktuell: '25000.00', reihenfolge: 8 },
    { guvId: '', kontonummer: '7a.', bezeichnung: 'Abschreibungen auf Sachanlagen', kategorie: 'ABSCHREIBUNG', betragVorjahr: '5000.00', betragAktuell: '5000.00', reihenfolge: 9 },
    { guvId: '', kontonummer: '7b.', bezeichnung: 'Abschreibungen auf Umlaufvermögen', kategorie: 'ABSCHREIBUNG', betragVorjahr: '0.00', betragAktuell: '0.00', reihenfolge: 10 },
    { guvId: '', kontonummer: '8.', bezeichnung: 'Sonstige betriebliche Aufwendungen', kategorie: 'SONSTIGE', betragVorjahr: '50000.00', betragAktuell: '50000.00', reihenfolge: 11 },
    { guvId: '', kontonummer: '9.', bezeichnung: 'Erträge aus Beteiligungen', kategorie: 'FINANZ', betragVorjahr: '0.00', betragAktuell: '0.00', reihenfolge: 12 },
    { guvId: '', kontonummer: '10.', bezeichnung: 'Erträge aus anderen Wertpapieren und Ausleihungen', kategorie: 'FINANZ', betragVorjahr: '0.00', betragAktuell: '0.00', reihenfolge: 13 },
    { guvId: '', kontonummer: '11.', bezeichnung: 'Sonstige Zinsen und ähnliche Erträge', kategorie: 'FINANZ', betragVorjahr: '100.00', betragAktuell: '100.00', reihenfolge: 14 },
    { guvId: '', kontonummer: '12.', bezeichnung: 'Abschreibungen auf Finanzanlagen', kategorie: 'FINANZ', betragVorjahr: '0.00', betragAktuell: '0.00', reihenfolge: 15 },
    { guvId: '', kontonummer: '13.', bezeichnung: 'Zinsen und ähnliche Aufwendungen', kategorie: 'FINANZ', betragVorjahr: '0.00', betragAktuell: '0.00', reihenfolge: 16 },
    { guvId: '', kontonummer: '14.', bezeichnung: 'Steuern vom Einkommen und vom Ertrag', kategorie: 'STEUER', betragVorjahr: '15000.00', betragAktuell: '15000.00', reihenfolge: 17 },
    { guvId: '', kontonummer: '15.', bezeichnung: 'Ergebnis nach Steuern', kategorie: 'STEUER', betragVorjahr: '35100.00', betragAktuell: '35100.00', reihenfolge: 18 },
    { guvId: '', kontonummer: '16.', bezeichnung: 'Sonstige Steuern', kategorie: 'STEUER', betragVorjahr: '0.00', betragAktuell: '0.00', reihenfolge: 19 },
    { guvId: '', kontonummer: '17.', bezeichnung: 'Jahresüberschuss/Jahresfehlbetrag', kategorie: 'STEUER', betragVorjahr: '35100.00', betragAktuell: '35100.00', reihenfolge: 20 },
  ];

  const guv = await prisma.guV.create({
    data: {
      mandantId: mandant1.id,
      bilanzId: bilanz.id,
      geschaeftsjahr: 2025,
      verfahren: 'GKV',
      status: 'DRAFT',
      hinweise: 'Seed-Daten (Gesamtkostenverfahren).',
      ergebnis: '35100.00',
      createdById: steuerberater.id,
      positionen: {
        create: guvSeedPositionen,
      },
    },
  });
  console.log(`[seed] GuV angelegt für ${MANDANT_DEMO} GJ 2025 (${guv.id})`);

  // ----------------------------------------------------------------------------
  // Demo-Anhang für Demo GmbH
  // ----------------------------------------------------------------------------
  const anhang = await prisma.anhang.create({
    data: {
      mandantId: mandant1.id,
      geschaeftsjahr: 2025,
      status: 'DRAFT',
      bilanzierungsMethoden:
        'Die Bilanz wurde nach den Vorschriften des Handelsgesetzbuches (HGB) aufgestellt. Die Bewertung der Vermögensgegenstände und Schulden erfolgte nach den Grundsätzen ordnungsmäßiger Buchführung.',
      bewertungsMethoden:
        'Die Sachanlagen wurden zu Anschaffungskosten bewertet. Forderungen und sonstige Vermögensgegenstände wurden zum Nennwert angesetzt. Verbindlichkeiten wurden mit ihrem Erfüllungsbetrag passiviert.',
      sonstigePflichtangaben:
        'Geschäftsführer: Max Demo. Mitarbeiterzahl im Geschäftsjahr: 3.',
      createdById: steuerberater.id,
      abschnitte: {
        create: [
          {
            titel: 'Allgemeine Angaben',
            inhalt:
              'Die Gesellschaft ist im Handelsregister des Amtsgerichts Hamburg unter HRB 123456 eingetragen. Der Sitz der Gesellschaft befindet sich in Hamburg.',
            reihenfolge: 1,
          },
          {
            titel: 'Bilanzierungs- und Bewertungsmethoden',
            inhalt:
              'Die Bilanz wurde nach den Vorschriften des Handelsgesetzbuches (HGB) aufgestellt. Die Bewertung der Vermögensgegenstände und Schulden erfolgte nach den Grundsätzen ordnungsmäßiger Buchführung (§ 252 HGB).',
            reihenfolge: 2,
          },
          {
            titel: 'Erläuterungen zur Bilanz',
            inhalt:
              'Sämtliche Forderungen haben eine Restlaufzeit von unter einem Jahr. Das gezeichnete Kapital ist voll eingezahlt.',
            reihenfolge: 3,
          },
          {
            titel: 'Erläuterungen zur GuV',
            inhalt:
              'Die Umsatzerlöse wurden im Inland erzielt. Die Erfassung erfolgt zum Zeitpunkt der Leistungserbringung.',
            reihenfolge: 4,
          },
          {
            titel: 'Sonstige Pflichtangaben',
            inhalt:
              'Geschäftsführer: Max Demo. Die Gesellschaft beschäftigte im Geschäftsjahr durchschnittlich 3 Mitarbeiter. Der Jahresüberschuss wird auf neue Rechnung vorgetragen.',
            reihenfolge: 5,
          },
        ],
      },
    },
  });
  console.log(`[seed] Anhang angelegt für ${MANDANT_DEMO} GJ 2025 (${anhang.id})`);

  // ----------------------------------------------------------------------------
  // 5 IDW-Standard-Prüfungsregeln (IDW PS 880) — seed
  // ----------------------------------------------------------------------------
  const idwRegeln: Prisma.PruefungsRegelCreateInput[] = [
    {
      code: 'IDW_EK_QUOTE',
      name: 'Eigenkapitalquote ≥ 0 (keine Überschuldung)',
      beschreibung:
        'Die Eigenkapitalquote muss ≥ 0 sein, sonst liegt eine bilanzielle Überschuldung gemäß § 19 InsO vor.',
      schweregrad: 'KRITISCH',
      istAktiv: true,
      konfiguration: {
        schwellwert: 0,
        vergleichsOperator: '>=',
        einheit: 'PROZENT',
      },
      reihenfolge: 1,
    },
    {
      code: 'IDW_LIQUIDITAET_1',
      name: 'Liquidität 1. Grades ≥ 0',
      beschreibung:
        'Die flüssigen Mittel (Kassenbestand + Bankguthaben, HGB-Position B.IV.) müssen ≥ 0 sein.',
      schweregrad: 'KRITISCH',
      istAktiv: true,
      konfiguration: {
        schwellwert: 0,
        vergleichsOperator: '>=',
        einheit: 'EURO',
      },
      reihenfolge: 2,
    },
    {
      code: 'IDW_VERSCHULDUNGSGRAD',
      name: 'Verschuldungsgrad ≤ 1000%',
      beschreibung:
        'Verbindlichkeiten + Rückstellungen / Eigenkapital × 100 ≤ 1000%. Branchenabhängig — Industrieunternehmen typisch ≤ 500%.',
      schweregrad: 'WARNUNG',
      istAktiv: true,
      konfiguration: {
        schwellwert: 1000,
        vergleichsOperator: '<=',
        einheit: 'PROZENT',
      },
      reihenfolge: 3,
    },
    {
      code: 'IDW_ANLAGEVERMOEGEN_BIS_AKTIVA',
      name: 'Anlagevermögen ≤ Aktiva-Summe',
      beschreibung:
        'Das Anlagevermögen (HGB-Position A.) darf die Bilanzsumme nicht überschreiten.',
      schweregrad: 'KRITISCH',
      istAktiv: true,
      konfiguration: {
        schwellwert: 0,
        vergleichsOperator: '>=',
        einheit: 'EURO',
      },
      reihenfolge: 4,
    },
    {
      code: 'IDW_GOING_CONCERN',
      name: 'Going Concern: EK + langfristige Rückstellungen ≥ 50% Aktiva',
      beschreibung:
        'Wenn Eigenkapital + langfristige Rückstellungen < 50% der Bilanzsumme, besteht ein Going-Concern-Risiko (§ 252 HGB).',
      schweregrad: 'WARNUNG',
      istAktiv: true,
      konfiguration: {
        schwellwert: 50,
        vergleichsOperator: '>=',
        einheit: 'PROZENT',
      },
      reihenfolge: 5,
    },
  ];
  for (const r of idwRegeln) {
    await prisma.pruefungsRegel.create({ data: r });
  }
  console.log(`[seed] IDW-Standardregeln angelegt: ${idwRegeln.length} Regeln`);

  // ----------------------------------------------------------------------------
  // PDF-Generation (M1)
  // ----------------------------------------------------------------------------
  // PDFs werden NICHT im Dev-Seed erzeugt (kein S3/MinIO im Default-Setup).
  // Trigger manuell via API:
  //   curl -X POST -H "Authorization: Bearer $TOKEN" \
  //        -H "Content-Type: application/json" \
  //        -d '{"mandantId":"<uuid>"}' \
  //        http://localhost:3000/api/pdf/bilanz/<bilanzId>/generate
  //
  // Voraussetzung: MinIO läuft + S3_BUCKET ist mit Object-Lock angelegt.
  // siehe SETUP.md § "MinIO / S3 Object Lock".
  console.log(
    '[seed] PDFs wurden NICHT automatisch generiert — manuell via /api/pdf/{bilanz,guv,anhang}/:id/generate triggern.',
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
