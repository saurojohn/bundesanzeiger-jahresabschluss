/**
 * Konstanten für den Anhang (§ 284-289 HGB).
 *
 * Der Anhang ergänzt Bilanz und GuV um Erläuterungen — diese
 * vordefinierten Abschnitte decken die Pflichtangaben ab.
 */

export const ANHANG_STATUS = ['DRAFT', 'VALIDATED', 'ARCHIVED'] as const;
export type AnhangStatus = (typeof ANHANG_STATUS)[number];

/**
 * Standardabschnitte für einen Anhang (gem. § 284 HGB).
 *
 * Werden im Seed als Default verwendet — User können beliebig eigene
 * Abschnitte ergänzen.
 */
export interface AnhangTemplateAbschnitt {
  titel: string;
  reihenfolge: number;
  inhaltVorlage: string;
}

export const ANHANG_TEMPLATE_ABSCHNITTE: AnhangTemplateAbschnitt[] = [
  {
    titel: 'Allgemeine Angaben',
    reihenfolge: 1,
    inhaltVorlage:
      '## Allgemeine Angaben\n\nDie Gesellschaft ist im Handelsregister des Amtsgerichts [Ort] unter HRB [Nummer] eingetragen. Der Sitz der Gesellschaft befindet sich in [Ort]. Die Gesellschaft wird beim Finanzamt [Ort] unter der Steuernummer [Steuernummer] geführt.',
  },
  {
    titel: 'Bilanzierungs- und Bewertungsmethoden',
    reihenfolge: 2,
    inhaltVorlage:
      '## Bilanzierungs- und Bewertungsmethoden\n\nDie Bilanz wurde nach den Vorschriften des Handelsgesetzbuches (HGB) aufgestellt. Die Bewertung der Vermögensgegenstände und Schulden erfolgte nach den Grundsätzen ordnungsmäßiger Buchführung (§ 252 HGB).',
  },
  {
    titel: 'Erläuterungen zur Bilanz',
    reihenfolge: 3,
    inhaltVorlage:
      '## Erläuterungen zur Bilanz\n\n### Anlagevermögen\nDie Entwicklung des Anlagevermögens ist im Anlagespiegel dargestellt.\n\n### Forderungen\nSämtliche Forderungen haben eine Restlaufzeit von unter einem Jahr.\n\n### Eigenkapital\nDas gezeichnete Kapital ist voll eingezahlt.',
  },
  {
    titel: 'Erläuterungen zur GuV',
    reihenfolge: 4,
    inhaltVorlage:
      '## Erläuterungen zur Gewinn- und Verlustrechnung\n\nDie Umsatzerlöse wurden im Inland erzielt. Die Erfassung der Umsatzerlöse erfolgt zum Zeitpunkt der Leistungserbringung.',
  },
  {
    titel: 'Sonstige Pflichtangaben',
    reihenfolge: 5,
    inhaltVorlage:
      '## Sonstige Pflichtangaben\n\n### Geschäftsführung\nGeschäftsführer: [Name]\n\n### Mitarbeiter\nDie Gesellschaft beschäftigte im Geschäftsjahr durchschnittlich [Anzahl] Mitarbeiter.\n\n### Ergebnisverwendung\nDer Jahresüberschuss wird auf neue Rechnung vorgetragen.',
  },
];