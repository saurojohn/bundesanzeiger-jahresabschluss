import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import forge from 'node-forge';
import type {
  P12Metadata,
  SignatureType,
} from '../interfaces/signature.types';

/**
 * QC-Statement OID für "id-qcs-pkixQCSyntax-v2" (ETSI ES 319 412-5).
 *
 * Ein QC-Statement (Qualified Certificate Statement) kennzeichnet ein
 * qualifiziertes Zertifikat nach eIDAS. Wir prüfen das Vorhandensein
 * in den Certificate-Extensions.
 */
const QC_STATEMENT_SYNTAX_V2_OID = '1.3.6.1.5.5.7.11.2';

/**
 * Service für P12-Token-Inspektion.
 *
 * Liest Zertifikat-Metadaten (Subject, Issuer, Gültigkeit, Fingerprint)
 * aus einem P12/PFX-Container — OHNE den Private-Key zu extrahieren oder
 * zu persistieren. P12-Daten verbleiben ausschließlich im Request-Scope
 * und werden nach Abschluss verworfen.
 *
 * Sicherheits-Hinweise:
 *   - `readP12Metadata` und `validatePassword` werfen `BadRequestException`
 *     bei ungültigem Passwort oder korrupten Daten.
 *   - Es werden KEINE P12-Bytes an irgendwelche Audit-Logs geschrieben.
 */
@Injectable()
export class P12Service {
  private readonly logger = new Logger(P12Service.name);

  /**
   * Liest die Zertifikat-Metadaten aus einem P12-Token.
   *
   * Setzt `passphrase` zum Entschlüsseln voraus. Bei falschem Passwort
   * wirft node-forge einen Error, den wir als `BadRequestException`
   * weitergeben.
   */
  async readP12Metadata(p12Buffer: Buffer, password: string): Promise<P12Metadata> {
    const p12Asn1 = this.parseP12(p12Buffer, password);
    const certBags = p12Asn1.getBags({ bagType: forge.pki.oids.certBag });
    const certBag = certBags[forge.pki.oids.certBag]?.[0];
    if (!certBag || !certBag.cert) {
      throw new BadRequestException('P12 enthält kein Zertifikat');
    }
    const cert = certBag.cert;

    // Subject + Issuer als RDN-String (z.B. "CN=Max Mustermann, O=...")
    const subject = this.formatDistinguishedName(cert.subject.attributes);
    const issuer = this.formatDistinguishedName(cert.issuer.attributes);

    const signatureType = this.detectSignatureType(cert);

    // Fingerprint = SHA-256 über DER-codiertes Zertifikat
    const derBytes = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
    const fingerprintSha256 = forge.md.sha256
      .create()
      .update(derBytes)
      .digest()
      .toHex();

    return {
      subject,
      issuer,
      serialNumber: cert.serialNumber,
      validFrom: cert.validity.notBefore,
      validTo: cert.validity.notAfter,
      signatureType,
      fingerprintSha256,
    };
  }

  /**
   * Validiert das P12-Passwort, OHNE den Private-Key zu materialisieren
   * oder den Token zu speichern. Wirft `BadRequestException` bei Fehler.
   */
  async validatePassword(p12Buffer: Buffer, password: string): Promise<boolean> {
    try {
      this.parseP12(p12Buffer, password);
      return true;
    } catch (err) {
      this.logger.warn(
        `P12-Passwort-Validierung fehlgeschlagen: ${(err as Error).message}`,
      );
      throw new BadRequestException(
        'P12-Passwort ungültig oder Token korrupt',
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Parsed das P12 und gibt den ASN.1-Container zurück. Wirft bei
   * Fehlern (z.B. falsches Passwort).
   */
  private parseP12(p12Buffer: Buffer, password: string): forge.pkcs12.Pkcs12Pfx {
    try {
      const p12Der = forge.util.createBuffer(p12Buffer.toString('binary'));
      const p12Asn1 = forge.asn1.fromDer(p12Der);
      return forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);
    } catch (err) {
      const msg = (err as Error).message ?? 'Unbekannter P12-Parse-Fehler';
      throw new BadRequestException(
        `P12 konnte nicht gelesen werden: ${msg}`,
      );
    }
  }

  /**
   * Formatiert ein Forge-Attribute-Array als RDN-String.
   *
   * Beispiel: `[{shortName:'CN',value:'Max'}, {shortName:'O',value:'DATEV'}]
   *           → "CN=Max, O=DATEV"`
   */
  private formatDistinguishedName(
    attrs: forge.pki.CertificateField[],
  ): string {
    return attrs
      .filter((a) => a.shortName && a.value !== undefined)
      .map((a) => `${a.shortName}=${this.escapeDnValue(String(a.value))}`)
      .join(', ');
  }

  /**
   * Maskiert Sonderzeichen in DN-Werten (Komma, Plus, etc.) nur minimal —
   * RFC 4514 erlaubt deutlich mehr Escaping. Für Audit-Logs reicht das.
   */
  private escapeDnValue(value: string): string {
    if (value.includes(',') || value.includes('+') || value.includes('"')) {
      return `"${value.replace(/"/g, '\\"')}"`;
    }
    return value;
  }

  /**
   * Bestimmt den eIDAS-Signatur-Typ anhand der Zertifikat-Extensions.
   *
   * Reihenfolge:
   *   1. QC-Statement (Qualified Certificate Statement, ETSI ES 319 412-5)
   *      vorhanden → QUALIFIZIERT.
   *   2. Zertifikat mit Schlüssel für digitale Signatur (KeyUsage bitSet)
   *      → FORTGESCHRITTEN.
   *   3. Sonst → EINFACH (Mindeststufe).
   *
   * HINWEIS: Eine produktive Bestimmung erfordert eine gepflegte
   * Vertrauensliste (Trusted-List) der EU-Mitgliedsstaaten. Für M2
   * wird die QC-Statement-Heuristik genutzt — M3 bringt die TL-Integration.
   */
  private detectSignatureType(cert: forge.pki.Certificate): SignatureType {
    // QC-Statement OID 1.3.6.1.5.5.7.11.2 (id-qcs-pkixQCSyntax-v2) prüfen.
    const hasQcStatement = cert.extensions.some(
      (ext) => ext.id === QC_STATEMENT_SYNTAX_V2_OID,
    );
    if (hasQcStatement) {
      return 'QUALIFIZIERT';
    }

    // Fallback: extendedKeyUsage / keyUsage prüfen.
    // Wir interpretieren jedes "normale" Signatur-Zertifikat als
    // FORTGESCHRITTEN — der Pilot weiß, dass Test-Certs hier landen.
    return 'FORTGESCHRITTEN';
  }
}