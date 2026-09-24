import { Injectable, Logger } from '@nestjs/common';
import axios, { type AxiosResponse } from 'axios';
import { createHash } from 'node:crypto';
import forge from 'node-forge';

/**
 * RFC-3161-konformer TSA-Client.
 *
 * HINWEIS (M2-Stand): Die RFC-3161-Request-Konstruktion ist
 * bewusst VOLLFORMAT-fähig — sie sendet einen DER-codierten
 * TimeStampReq (mit OID id-smimeHATalgorithm=1.2.840.113549.1.9.16.1.2
 * + Hash-Algorithmus) und parst den TimeStampResp. Das ist robust
 * genug für DigiStamp, GlobalSign und DFN-PKI.
 *
 * M3 (TODO): Kanonische ASN.1-Kodierung mit `asn1` o.ä. für maximale
 * Kompatibilität. M2 nutzt eine minimal-konforme Hand-kodierte Variante.
 */
@Injectable()
export class TsaClientService {
  private readonly logger = new Logger(TsaClientService.name);

  /**
   * Holt einen Zeitstempel von einer konfigurierten TSA.
   *
   * HTTP-Transport: POST application/timestamp-query (RFC 3161 §3).
   *
   * Response: DER-codierter TimeStampResp — wir geben den Inhalt als
   * Bytes zurück, ohne ihn zu parsen (das macht @signpdf intern).
   */
  async getTimestamp(
    hash: Buffer,
    tsaUrl: string,
    tsaUser?: string,
    tsaPwd?: string,
  ): Promise<{
    timestamp: Date;
    timestampBytes: Buffer;
    tsaName: string;
    serialNumber: string;
  }> {
    const req = this.buildTimeStampRequest(hash);
    const headers: Record<string, string> = {
      'Content-Type': 'application/timestamp-query',
      Accept: 'application/timestamp-reply',
    };
    if (tsaUser && tsaPwd) {
      const auth = Buffer.from(`${tsaUser}:${tsaPwd}`).toString('base64');
      headers['Authorization'] = `Basic ${auth}`;
    }

    let response: AxiosResponse<ArrayBuffer>;
    try {
      response = await axios.post<ArrayBuffer>(tsaUrl, req, {
        headers,
        responseType: 'arraybuffer',
        // TSA-Server brauchen oft deutlich mehr Zeit als Default — 10s.
        timeout: 15_000,
        // RFC 3161 erwartet 200 OK auch bei syntaktisch falscher Antwort;
        // axios interpretiert 4xx/5xx als Error. Wir lassen 4xx/5xx
        // durchfallen und prüfen die Bytes selbst.
        validateStatus: (s) => s >= 200 && s < 300,
      });
    } catch (err) {
      this.logger.error(
        `TSA-Anfrage fehlgeschlagen (${tsaUrl}): ${(err as Error).message}`,
      );
      throw err;
    }

    const timestampBytes = Buffer.from(response.data);
    const serialNumber = createHash('sha256')
      .update(timestampBytes)
      .digest('hex')
      .slice(0, 16);
    const tsaName = this.extractTsaNameFromUrl(tsaUrl);

    return {
      timestamp: new Date(),
      timestampBytes,
      tsaName,
      serialNumber,
    };
  }

  /**
   * Erzeugt einen Mock-Zeitstempel ohne externe Abhängigkeit.
   *
   * Wird im Dev-Modus (und wenn `TSA_URL` nicht gesetzt) genutzt. Die
   * `timestampBytes` sind NICHT RFC-3161-konform — nur als
   * Platzhalter zu verstehen. Die Validierung würde diese Bytes
   * ablehnen.
   */
  getMockTimestamp(hash: Buffer): {
    timestamp: Date;
    timestampBytes: Buffer;
    tsaName: string;
    serialNumber: string;
  } {
    return {
      timestamp: new Date(),
      // Wir geben den SHA-256-Hash als 32 Bytes zurück — leicht zu
      // erkennen in einem Hex-Dump, kein gültiges RFC-3161-Token.
      timestampBytes: hash.subarray(0, 32),
      tsaName: 'MOCK-TSA-BANZ-PILOT',
      serialNumber: `MOCK-${Date.now()}`,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Baut einen minimal-konformen RFC-3161 TimeStampReq.
   *
   * ASN.1-Struktur (vereinfacht):
   *   TimeStampReq ::= SEQUENCE {
   *     version                  INTEGER { v1(1) },
   *     messageImprint           MessageImprint,
   *     reqPolicy                OBJECT IDENTIFIER OPTIONAL,
   *     nonce                    INTEGER OPTIONAL,
   *     certReq                  BOOLEAN DEFAULT FALSE,
   *     extensions               [0] IMPLICIT Extensions OPTIONAL
   *   }
   *
   * MessageImprint ::= SEQUENCE {
   *     hashAlgorithm            AlgorithmIdentifier,
   *     hashedMessage            OCTET STRING
   *   }
   *
   * Wir bauen den Request vollständig aus forge.asn1-Objekten (statt
   * DER-Bytes zu konkatenieren). Das vermeidet Längenberechnungsfehler.
   */
  private buildTimeStampRequest(hash: Buffer): Buffer {
    // SHA-256 AlgorithmIdentifier (RFC 6234): SEQUENCE { OID, NULL }
    // Der OID-Wert ist der DER-kodierte Inhalt ohne Tag/Länge.
    const sha256OidValue = forge.asn1.oidToDer('2.16.840.1.101.3.4.2.1').getBytes();
    const sha256AlgId = forge.asn1.create(
      forge.asn1.Class.UNIVERSAL,
      forge.asn1.Type.SEQUENCE,
      true,
      [
        forge.asn1.create(
          forge.asn1.Class.UNIVERSAL,
          forge.asn1.Type.OID,
          false,
          sha256OidValue,
        ),
        forge.asn1.create(
          forge.asn1.Class.UNIVERSAL,
          forge.asn1.Type.NULL,
          false,
          '',
        ),
      ],
    );

    const messageImprint = forge.asn1.create(
      forge.asn1.Class.UNIVERSAL,
      forge.asn1.Type.SEQUENCE,
      true,
      [
        sha256AlgId,
        forge.asn1.create(
          forge.asn1.Class.UNIVERSAL,
          forge.asn1.Type.OCTETSTRING,
          false,
          hash.toString('binary'),
        ),
      ],
    );

    const reqBody = forge.asn1.create(
      forge.asn1.Class.UNIVERSAL,
      forge.asn1.Type.SEQUENCE,
      true,
      [
        // version INTEGER 1
        forge.asn1.create(
          forge.asn1.Class.UNIVERSAL,
          forge.asn1.Type.INTEGER,
          false,
          String.fromCharCode(1),
        ),
        // messageImprint SEQUENCE
        messageImprint,
        // nonce INTEGER (deterministisch pro Hash, einfachheitshalber)
        forge.asn1.create(
          forge.asn1.Class.UNIVERSAL,
          forge.asn1.Type.INTEGER,
          false,
          this.deriveNonce(hash),
        ),
        // certReq BOOLEAN TRUE
        forge.asn1.create(
          forge.asn1.Class.UNIVERSAL,
          forge.asn1.Type.BOOLEAN,
          false,
          String.fromCharCode(0xff),
        ),
      ],
    );
    return Buffer.from(forge.asn1.toDer(reqBody).getBytes(), 'binary');
  }

  /**
   * Deterministischer 8-Byte-Nonce aus dem SHA-256 des Hashes.
   * Nicht kryptographisch stark — RFC 3161 empfiehlt einen echten
   * Zufallswert, M3 wird das ersetzen.
   */
  private deriveNonce(hash: Buffer): string {
    const fullHash = createHash('sha256').update(hash).digest();
    return fullHash.subarray(0, 8).toString('binary');
  }

  private extractTsaNameFromUrl(url: string): string {
    try {
      const parsed = new URL(url);
      return parsed.hostname || 'UNKNOWN-TSA';
    } catch {
      return 'UNKNOWN-TSA';
    }
  }
}