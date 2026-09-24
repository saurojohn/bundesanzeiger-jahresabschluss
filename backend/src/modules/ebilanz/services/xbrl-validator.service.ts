import { Injectable, Logger } from '@nestjs/common';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type {
  ValidationResultDto,
  ValidationIssue,
} from '../dto/validation-result.dto';

const SALDO_TOLERANZ_CENTS = 1; // 0.01 EUR Toleranz

/**
 * Strukturelle XBRL-Validation (ohne XSD-Parsing).
 *
 * Wir verwenden:
 *   - fast-xml-parser: well-formed-Check + XML-Struktur-Extraktion
 *   - Eigene Business-Rule-Checks: Saldo, Pflicht-Felder, Calculation-Validität
 *
 * Eine XSD-Validierung gegen die amtliche HGB-KT-XSD-Datei wäre der
 * letzte Schritt — sie erfordert libxmljs2 (native, schwer zu installieren)
 * oder AriesXBRLEvaluator (Java). Wir verlassen uns auf die strukturelle
 * + Business-Rule-Validierung und überlassen die finale XSD-Validierung
 * dem ERiC-SDK bei tatsächlicher ERiC-Submission.
 */
@Injectable()
export class XbrlValidatorService {
  private readonly logger = new Logger(XbrlValidatorService.name);

  /**
   * Validiert eine XBRL-Datei (Buffer oder base64-String).
   */
  async validateXbrl(input: string | Buffer): Promise<ValidationResultDto> {
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    let xmlString: string;
    if (typeof input === 'string') {
      // Akzeptiere rohen XML oder base64.
      const trimmed = input.trim();
      if (trimmed.startsWith('<?xml') || trimmed.startsWith('<')) {
        xmlString = trimmed;
      } else {
        try {
          xmlString = Buffer.from(trimmed, 'base64').toString('utf-8');
        } catch {
          errors.push({ code: 'INVALID_INPUT', message: 'Input ist weder XML noch base64-XML' });
          return { valid: false, errors, warnings };
        }
      }
    } else {
      xmlString = input.toString('utf-8');
    }

    // 1. Well-formed XML-Check.
    const xsdResult = XMLValidator.validate(xmlString);
    if (xsdResult !== true) {
      errors.push({
        code: 'MALFORMED_XML',
        message: `XML nicht well-formed: ${JSON.stringify(xsdResult)}`,
      });
      return { valid: false, errors, warnings };
    }

    // 2. Parsen + Facts extrahieren.
    const parser = new XMLParser({
      ignoreAttributes: false,
      parseAttributeValue: true,
      removeNSPrefix: false,
      isArray: (name, _jpath, _isLeafNode, _isAttribute) => {
        // Wir wollen, dass gleiche Konzepte als Array geparst werden.
        return name === 'xbrli:context' || name === 'xbrli:unit';
      },
    });
    const parsed = parser.parse(xmlString);

    const root = parsed['xbrli:xbrl'];
    if (!root) {
      errors.push({ code: 'MISSING_XBRL_ROOT', message: 'Wurzelelement xbrli:xbrl fehlt' });
      return { valid: false, errors, warnings };
    }

    // 3. Context-Refs V_D und V_Y vorhanden?
    const contexts = Array.isArray(root['xbrli:context']) ? root['xbrli:context'] : [];
    const hasVD = contexts.some((c: { '@_id'?: string }) => c['@_id'] === 'V_D');
    const hasVY = contexts.some((c: { '@_id'?: string }) => c['@_id'] === 'V_Y');
    if (!hasVD) {
      errors.push({ code: 'MISSING_CONTEXT_V_D', message: 'Context V_D (Duration) fehlt' });
    }
    if (!hasVY) {
      errors.push({ code: 'MISSING_CONTEXT_V_Y', message: 'Context V_Y (Instant) fehlt' });
    }

    // 4. Unit EUR vorhanden?
    const units = Array.isArray(root['xbrli:unit']) ? root['xbrli:unit'] : [];
    const hasEUR = units.some((u: { '@_id'?: string }) => u['@_id'] === 'EUR');
    if (!hasEUR) {
      warnings.push({ code: 'MISSING_UNIT_EUR', message: 'Unit EUR fehlt' });
    }

    // 5. Facts sammeln.
    const facts = this.extractFacts(root);

    // 6. Pflicht-GenInfo-Felder.
    if (!facts.companyName || String(facts.companyName).trim() === '') {
      errors.push({
        code: 'MISSING_COMPANY_NAME',
        message: 'Firmenname (genInfo.companyInfo.companyName) fehlt',
      });
    }
    if (!facts.taxNumber || String(facts.taxNumber).trim() === '') {
      errors.push({
        code: 'MISSING_TAX_NUMBER',
        message: 'Steuernummer (genInfo.companyInfo.taxNumber) fehlt',
      });
    }
    if (!facts.fiscalYearBegin || String(facts.fiscalYearBegin).trim() === '') {
      errors.push({
        code: 'MISSING_FISCAL_YEAR_BEGIN',
        message: 'Geschäftsjahresbeginn fehlt',
      });
    }
    if (!facts.fiscalYearEnd || String(facts.fiscalYearEnd).trim() === '') {
      errors.push({
        code: 'MISSING_FISCAL_YEAR_END',
        message: 'Geschäftsjahresende fehlt',
      });
    }

    // 7. Bilanz-Saldo: Aktiva == Passiva.
    const diff = Math.abs(facts.aktivaSumme - facts.passivaSumme);
    if (diff > SALDO_TOLERANZ_CENTS) {
      errors.push({
        code: 'BILANCE_MISMATCH',
        message: `Aktiva-Summe (${facts.aktivaSumme}) ≠ Passiva-Summe (${facts.passivaSumme}); Differenz = ${diff.toFixed(2)} EUR`,
      });
    }

    // 8. Calculation-Check: Erlöse - Aufwände ≈ Jahresüberschuss.
    if (facts.netIncome !== null) {
      const expectedNetIncome = facts.erloeseSumme - facts.aufwandSumme;
      if (Math.abs(expectedNetIncome - facts.netIncome) > SALDO_TOLERANZ_CENTS) {
        warnings.push({
          code: 'NET_INCOME_MISMATCH',
          message: `Erwarteter Jahresüberschuss (Σ Erlöse - Σ Aufwand = ${expectedNetIncome.toFixed(2)}) weicht vom ausgewiesenen Nettoergebnis (${facts.netIncome.toFixed(2)}) ab.`,
        });
      }
    }

    // 9. Pflicht-Bilanzpositionen vorhanden.
    const requiredBilanz = ['bs.eqLiab.equity.subscribed', 'bs.ass.currAss.cashEquiv.bank'];
    for (const req of requiredBilanz) {
      if (!(req in facts.factMap)) {
        warnings.push({
          code: 'MISSING_PFLICHT_BILANZPOSITION',
          message: `Pflicht-Bilanzposition ${req} fehlt`,
          conceptCode: req,
        });
      }
    }

    // 10. Pflicht-GuV-Positionen vorhanden.
    const requiredGuv = ['pl.rev', 'pl.netIncome'];
    for (const req of requiredGuv) {
      if (!(req in facts.factMap)) {
        warnings.push({
          code: 'MISSING_PFLICHT_GUV_POSITION',
          message: `Pflicht-GuV-Position ${req} fehlt`,
          conceptCode: req,
        });
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Extrahiert alle bekannten Facts aus dem XBRL-Baum.
   */
  private extractFacts(root: Record<string, unknown>): {
    companyName: string | null;
    taxNumber: string | null;
    legalForm: string | null;
    fiscalYearBegin: string | null;
    fiscalYearEnd: string | null;
    aktivaSumme: number;
    passivaSumme: number;
    netIncome: number | null;
    erloeseSumme: number;
    aufwandSumme: number;
    factMap: Record<string, number | string>;
  } {
    const factMap: Record<string, number | string> = {};

    // Wir suchen alle Element-Names (ohne Namespace-Präfix-Probleme).
    // fast-xml-parser lässt Präfixe intakt; wir vereinheitlichen via Lowercase-Vergleich.
    const candidateKeys = Object.keys(root).filter(
      (k) => k !== 'xbrli:context' && k !== 'xbrli:unit' && k !== 'link:schemaRef',
    );

    for (const key of candidateKeys) {
      const value = root[key];
      if (value === undefined || value === null) continue;
      // Konzepte mit total="true" (Bilanz-Summen) extrahieren.
      if (key === 'bs.ass' || key === 'bs.eqLiab') {
        const totalValue = this.extractFactValue(value);
        if (totalValue !== null) {
          factMap[key] = totalValue;
        }
        continue;
      }
      // Sonstige Konzepte.
      const v = this.extractFactValue(value);
      if (v !== null) factMap[key] = v;
    }

    // Alternativ-Parse: durchsuche alle Sub-Elemente (falls Array).
    const collectFromChildren = (obj: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
          // Attribute-Namespace-Suffixe ignorieren.
          if (k.startsWith('@_')) continue;
          if (k === '#text') continue;
          // Falls bereits gemappt, nicht doppelt.
          if (factMap[k] !== undefined) continue;
          const val = this.extractFactValue(v);
          if (val !== null) factMap[k] = val;
        }
      }
    };
    collectFromChildren(root);

    return {
      companyName: this.toStr(factMap['genInfo.companyInfo.companyName']),
      taxNumber: this.toStr(factMap['genInfo.companyInfo.taxNumber']),
      legalForm: this.toStr(factMap['genInfo.companyInfo.legalForm']),
      fiscalYearBegin: this.toStr(factMap['genInfo.reporting.fiscalYearBegin']),
      fiscalYearEnd: this.toStr(factMap['genInfo.reporting.fiscalYearEnd']),
      aktivaSumme: this.toNum(factMap['bs.ass']),
      passivaSumme: this.toNum(factMap['bs.eqLiab']),
      netIncome: factMap['pl.netIncome'] !== undefined ? this.toNum(factMap['pl.netIncome']) : null,
      erloeseSumme: this.sumConcepts(factMap, ['pl.rev', 'pl.othOpRev.oth', 'pl.finResult.participationIncome', 'pl.finResult.securitiesIncome', 'pl.finResult.interestIncome', 'pl.chgInv', 'pl.othOpRev.activatedOwnWork']),
      aufwandSumme: this.sumConcepts(factMap, [
        'pl.costOfMat.rawMat',
        'pl.costOfMat.services',
        'pl.costOfEmpl.wages',
        'pl.costOfEmpl.socialExp',
        'pl.deprAmort.fixAss',
        'pl.deprAmort.currAss',
        'pl.otherCost',
        'pl.finResult.deprFinAss',
        'pl.finResult.interestExpense',
        'pl.tax.incomeTax',
        'pl.tax.othTax',
        'pl.sellCost',
        'pl.adminCost',
        'pl.costOfSales',
      ]),
      factMap,
    };
  }

  /**
   * Extrahiert den Wert eines Fact-Elements.
   *
   * fast-xml-parser liefert für `<foo>123</foo>` entweder `"123"` (string)
   * oder `123` (number), je nach `parseAttributeValue`. Attribute stehen
   * in `@_name`-Properties.
   */
  private extractFactValue(value: unknown): number | string | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string' || typeof value === 'number') return value;
    if (typeof value === 'object' && value !== null) {
      const obj = value as Record<string, unknown>;
      // Wenn @_total="true" → Summe; wir nehmen den Text.
      const text = obj['#text'];
      if (typeof text === 'string' || typeof text === 'number') return text;
      // Falls ein Objekt ohne #text: leer.
      return null;
    }
    return null;
  }

  private toStr(v: unknown): string | null {
    if (v === null || v === undefined) return null;
    return String(v);
  }

  private toNum(v: unknown): number {
    if (v === null || v === undefined) return 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  private sumConcepts(facts: Record<string, number | string>, codes: string[]): number {
    let sum = 0;
    for (const c of codes) {
      if (c in facts) sum += this.toNum(facts[c]);
    }
    return Number(sum.toFixed(2));
  }
}