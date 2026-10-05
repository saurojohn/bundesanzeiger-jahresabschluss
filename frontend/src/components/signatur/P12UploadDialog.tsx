'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiFetch, getAccessToken, getActiveMandantId } from '@/lib/api';

type P12Metadata = {
  subject: string;
  issuer: string;
  serialNumber: string;
  validFrom: string;
  validTo: string;
  signatureType: 'EINFACH' | 'FORTGESCHRITTEN' | 'QUALIFIZIERT';
  fingerprintSha256: string;
};

type SignatureResult = {
  signatureId: string;
  signedPdfWormKey: string;
  certificateMetadata: P12Metadata;
  timestamp?: string;
  hashBefore: string;
  hashAfter: string;
};

export function P12UploadDialog({
  bilanzId,
  guvId,
  anhangId,
  jahresabschlussId,
  signTarget,
  onClose,
}: {
  bilanzId?: string;
  guvId?: string;
  anhangId?: string;
  jahresabschlussId?: string;
  /**
   * Worauf die Signatur angewendet werden soll.
   *
   * Bugfix 2026-10-05: Das Ziel wurde aus einer Prioritaetskette abgeleitet
   * (abschluss → anhang → guv → bilanz). `BilanzForm` uebergibt neben der
   * Bilanz auch `guvId` und `anhangId` — fuer den DATEV-Export. Ein Klick auf
   * "PDF signieren" haette damit die **GuV** signiert, waehrend der Anwender
   * die Bilanz vor sich hat. Bei einer Signatur nach § 126 AO ist das kein
   * Anzeigefehler, sondern ein falsch signiertes Dokument.
   *
   * Der Aufrufer (`ExportActions`) weiss, welcher EntityType gerade
   * angezeigt wird, und gibt ihn deshalb explizit mit.
   */
  signTarget?: 'bilanz' | 'guv' | 'anhang' | 'abschluss';
  onClose: () => void;
}) {
  const t = useTranslations();
  const [p12Base64, setP12Base64] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [signatureType, setSignatureType] =
    useState<'EINFACH' | 'FORTGESCHRITTEN' | 'QUALIFIZIERT'>('QUALIFIZIERT');
  const [includeTimestamp, setIncludeTimestamp] = useState(true);
  const [metadata, setMetadata] = useState<P12Metadata | null>(null);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [signing, setSigning] = useState(false);
  const [result, setResult] = useState<SignatureResult | null>(null);
  const [signError, setSignError] = useState<string | null>(null);

  function readFileAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Remove data:application/x-pkcs12;base64, prefix
        const base64 = result.split(',')[1] ?? '';
        resolve(base64);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFilename(file.name);
    const base64 = await readFileAsBase64(file);
    setP12Base64(base64);
    setMetadata(null);
    setInspectError(null);
  }

  async function handleInspect() {
    if (!p12Base64 || !password) return;
    setInspecting(true);
    setInspectError(null);
    try {
      const token = getAccessToken();
      if (!token) return;
      const data = await apiFetch<P12Metadata>(
        '/signatur/inspect-p12',
        {
          method: 'POST',
          accessToken: token,
          body: JSON.stringify({ p12Base64, p12Password: password }),
        },
      );
      setMetadata(data);
    } catch (err) {
      setInspectError(
        err instanceof Error ? err.message : 'Token-Prüfung fehlgeschlagen',
      );
    } finally {
      setInspecting(false);
    }
  }

  async function handleSign() {
    if (!p12Base64 || !password) return;
    setSigning(true);
    setSignError(null);
    try {
      const token = getAccessToken();
      const mandantId = getActiveMandantId();
      if (!token || !mandantId) return;

      // Das Ziel kommt ausdruecklich vom Aufrufer. Ohne `signTarget` wird
      // die ID genommen, die zum angezeigten EntityType gehoert — nicht die
      // erste vorhandene aus der Liste.
      const ziel = signTarget ?? 'bilanz';
      const zielId =
        ziel === 'abschluss'
          ? jahresabschlussId
          : ziel === 'anhang'
            ? anhangId
            : ziel === 'guv'
              ? guvId
              : bilanzId;

      if (!zielId) {
        setSignError(
          'Für diese Ansicht ist kein Datensatz zum Signieren vorhanden.',
        );
        return;
      }

      const endpoint = `/signatur/sign-${ziel}`;
      const body: Record<string, string | boolean> = {
        mandantId,
        p12Base64,
        p12Password: password,
        signatureType,
        includeTimestamp,
        [`${ziel === 'abschluss' ? 'jahresabschluss' : ziel}Id`]: zielId,
      };

      const signResult = await apiFetch<{
        signatureId: string;
        signedPdfBase64: string;
        signedPdfWormKey: string;
        certificateMetadata: P12Metadata;
        timestamp?: string;
        hashBefore: string;
        hashAfter: string;
      }>(endpoint, {
        method: 'POST',
        accessToken: token,
        body: JSON.stringify(body),
      });

      // Download signed PDF
      const blob = await fetch(
        `data:application/pdf;base64,${signResult.signedPdfBase64}`,
      ).then((r) => r.blob());
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${endpoint.split('/').pop()}-signed.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setResult({
        signatureId: signResult.signatureId,
        signedPdfWormKey: signResult.signedPdfWormKey,
        certificateMetadata: signResult.certificateMetadata,
        timestamp: signResult.timestamp,
        hashBefore: signResult.hashBefore,
        hashAfter: signResult.hashAfter,
      });
    } catch (err) {
      setSignError(err instanceof Error ? err.message : 'Signatur fehlgeschlagen');
    } finally {
      setSigning(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-900 bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">
            {t('exports.signatur.title')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
          >
            ✕
          </button>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-sm text-slate-600">
            {t('exports.signatur.description')}
          </p>

          {/* Step 1: Upload P12 */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              {t('exports.signatur.uploadP12')}
            </label>
            <input
              type="file"
              accept=".p12,.pfx"
              onChange={handleFileSelect}
              className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
            />
            {filename && (
              <p className="mt-1 text-xs text-slate-500">{filename}</p>
            )}
          </div>

          {/* Step 2: Password */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              {t('exports.signatur.p12Password')}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="off"
              className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          {/* Step 3: Inspect */}
          <button
            type="button"
            onClick={handleInspect}
            disabled={!p12Base64 || !password || inspecting}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {inspecting ? t('exports.signatur.inspecting') : t('exports.signatur.inspect')}
          </button>

          {inspectError && (
            <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
              {inspectError}
            </div>
          )}

          {/* Step 4: Metadata Preview */}
          {metadata && (
            <div className="bg-slate-50 rounded-md p-4 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-xs text-slate-500">
                    {t('exports.signatur.inspectResult.subject')}
                  </div>
                  <div className="font-medium text-slate-900">
                    {metadata.subject}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">
                    {t('exports.signatur.inspectResult.issuer')}
                  </div>
                  <div className="font-medium text-slate-900">
                    {metadata.issuer}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">
                    {t('exports.signatur.inspectResult.validFrom')}
                  </div>
                  <div className="font-medium text-slate-900">
                    {new Date(metadata.validFrom).toLocaleDateString('de-DE')}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">
                    {t('exports.signatur.inspectResult.validTo')}
                  </div>
                  <div
                    className={
                      'font-medium ' +
                      (new Date(metadata.validTo) < new Date()
                        ? 'text-red-700'
                        : 'text-slate-900')
                    }
                  >
                    {new Date(metadata.validTo).toLocaleDateString('de-DE')}
                  </div>
                </div>
                <div className="col-span-2">
                  <div className="text-xs text-slate-500">
                    {t('exports.signatur.inspectResult.serialNumber')}
                  </div>
                  <div className="font-mono text-xs text-slate-700">
                    {metadata.serialNumber}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 5: Signature Type + Timestamp */}
          {metadata && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {t('exports.signatur.signaturType')}
                </label>
                <select
                  value={signatureType}
                  onChange={(e) =>
                    setSignatureType(
                      e.target.value as 'EINFACH' | 'FORTGESCHRITTEN' | 'QUALIFIZIERT',
                    )
                  }
                  className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="QUALIFIZIERT">{t('exports.signatur.QUALIFIZIERT')}</option>
                  <option value="FORTGESCHRITTEN">{t('exports.signatur.FORTGESCHRITTEN')}</option>
                  <option value="EINFACH">{t('exports.signatur.EINFACH')}</option>
                </select>
              </div>
              <div className="flex items-end">
                <label className="flex items-center text-sm">
                  <input
                    type="checkbox"
                    checked={includeTimestamp}
                    onChange={(e) => setIncludeTimestamp(e.target.checked)}
                    className="mr-2"
                  />
                  {t('exports.signatur.includeTimestamp')}
                </label>
              </div>
            </div>
          )}

          {/* Step 6: Sign Button */}
          {metadata && (
            <button
              type="button"
              onClick={handleSign}
              disabled={signing}
              className="w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {signing ? '…' : t('exports.signatur.sign')}
            </button>
          )}

          {signError && (
            <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
              {signError}
            </div>
          )}

          {/* Step 7: Result */}
          {result && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-md p-4 text-sm">
              <h3 className="font-medium text-emerald-900 mb-2">
                {t('exports.signatur.result.title')}
              </h3>
              <div className="space-y-1 text-emerald-800">
                <div>
                  <span className="text-xs">{t('exports.signatur.result.signatureId')}:</span>{' '}
                  <span className="font-mono text-xs">{result.signatureId.slice(0, 16)}…</span>
                </div>
                <div>
                  <span className="text-xs">{t('exports.signatur.result.wormKey')}:</span>{' '}
                  <span className="font-mono text-xs">{result.signedPdfWormKey.slice(0, 32)}…</span>
                </div>
                <div>
                  <span className="text-xs">{t('exports.signatur.result.timestamp')}:</span>{' '}
                  {result.timestamp
                    ? new Date(result.timestamp).toLocaleString('de-DE')
                    : '—'}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}