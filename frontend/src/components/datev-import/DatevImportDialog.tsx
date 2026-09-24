'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiFetch, getAccessToken, getActiveMandantId } from '@/lib/api';

/**
 * 6-Schritte-Wizard für DATEV-Import (CSV → Bilanz/GuV).
 *
 * Schritte:
 *   1. Datei-Upload (Drag-and-Drop oder File-Input)
 *   2. Parse-Vorschau (Tabelle erste 20 Buchungs-Zeilen)
 *   3. Salden-Berechnung (Soll/Haben/Saldo pro Sachkonto)
 *   4. Mapping-Vorschau (DATEV-Konto → HGB-Position)
 *   5. Konflikt-Resolver (manuelle Zuordnung unmapped Konten)
 *   6. Confirm + Result (Import-Button + Erfolgsmeldung)
 */

type PreviewResponse = {
  parsed: {
    formatName: string;
    version: number;
    beraternummer: string;
    mandantennummer: string;
    sachkontenlaenge: 4 | 5;
    buchungstyp: number;
    bezeichnung: string;
  };
  saldovortrag: Array<{
    konto: string;
    soll: number;
    haben: number;
    saldo: number;
    buchungsCount: number;
  }>;
  mappedPositionen: Array<{
    datevKonto: string;
    saldo: number;
    buchungsCount: number;
    mapping: null | {
      datevKonto: string;
      hgbPosition: string;
      hgbKontoNr: string;
      kategorie: string;
      confidence: number;
    };
    autoMapped: boolean;
    userOverride: boolean;
    warning?: string;
  }>;
  unmappedKonten: string[];
  warnings: string[];
};

type ImportResult = {
  importedCount: number;
  skippedCount: number;
  bilanzId: string | null;
  guvId: string | null;
  warnings: string[];
  overwriteWarned: boolean;
};

const STEPS = [
  'upload',
  'parsePreview',
  'saldovortrag',
  'mapping',
  'resolver',
  'confirm',
] as const;

type StepKey = (typeof STEPS)[number];

export function DatevImportDialog({
  geschaeftsjahr,
  onClose,
  onImported,
}: {
  geschaeftsjahr: number;
  onClose: () => void;
  onImported: () => void;
}) {
  const t = useTranslations();
  const [step, setStep] = useState<StepKey>('upload');
  const [csvBase64, setCsvBase64] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [userOverrides, setUserOverrides] = useState<Record<string, string>>({});
  const [overwriteExisting, setOverwriteExisting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  function handleFile(file: File) {
    setError(null);
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const arrayBuffer = reader.result as ArrayBuffer;
      const base64 = arrayBufferToBase64(arrayBuffer);
      setCsvBase64(base64);
    };
    reader.onerror = () => setError('Fehler beim Lesen der Datei');
    reader.readAsArrayBuffer(file);
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.name.toLowerCase().endsWith('.csv')) {
      handleFile(file);
    } else {
      setError(t('datevImport.errors.notACsvFile'));
    }
  }

  async function loadPreview() {
    setBusy(true);
    setError(null);
    try {
      const token = getAccessToken();
      const mandantId = getActiveMandantId();
      if (!token || !mandantId) return;

      const result = await apiFetch<PreviewResponse>('/datev-import/preview', {
        method: 'POST',
        accessToken: token,
        body: JSON.stringify({
          csvBase64,
          mandantId,
          geschaeftsjahr,
        }),
      });
      setPreview(result);
      setStep('parsePreview');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('datevImport.errors.parseFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function executeImport() {
    setBusy(true);
    setError(null);
    try {
      const token = getAccessToken();
      const mandantId = getActiveMandantId();
      if (!token || !mandantId) return;

      const result = await apiFetch<ImportResult>('/datev-import/execute', {
        method: 'POST',
        accessToken: token,
        body: JSON.stringify({
          csvBase64,
          mandantId,
          geschaeftsjahr,
          userMappingOverrides: userOverrides,
          overwriteExisting,
        }),
      });
      setResult(result);
      setStep('confirm');
      onImported();
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('datevImport.errors.importFailed');
      setError(msg);
      // 400 mit overwrite-Hinweis → User muss overwriteExisting setzen
      if (msg.includes('overwriteExisting')) {
        // Bleibe auf resolver-Schritt
      }
    } finally {
      setBusy(false);
    }
  }

  function nextStep() {
    const idx = STEPS.indexOf(step);
    if (idx < STEPS.length - 1) {
      setStep(STEPS[idx + 1]!);
    }
  }

  function prevStep() {
    const idx = STEPS.indexOf(step);
    if (idx > 0) setStep(STEPS[idx - 1]!);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center">
          <h2 className="text-lg font-semibold text-slate-900">
            {t('datevImport.title')} — {geschaeftsjahr}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-2xl leading-none"
            aria-label="Schließen"
          >
            ×
          </button>
        </div>

        {/* Stepper */}
        <div className="px-6 py-3 border-b border-slate-200 bg-slate-50">
          <ol className="flex flex-wrap gap-2 text-xs">
            {STEPS.map((s, idx) => (
              <li
                key={s}
                className={
                  'rounded px-2 py-1 ' +
                  (s === step
                    ? 'bg-brand-600 text-white font-medium'
                    : 'text-slate-500')
                }
              >
                {idx + 1}. {t(`datevImport.steps.${s}`)}
              </li>
            ))}
          </ol>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {step === 'upload' && (
            <UploadStep
              fileName={fileName}
              onDrop={onDrop}
              onFileChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
              onNext={() => void loadPreview()}
              busy={busy}
              ready={!!csvBase64}
            />
          )}

          {step === 'parsePreview' && preview && (
            <ParsePreviewStep
              preview={preview}
              fileName={fileName}
              onBack={prevStep}
              onNext={nextStep}
            />
          )}

          {step === 'saldovortrag' && preview && (
            <SaldovortragStep
              preview={preview}
              onBack={prevStep}
              onNext={nextStep}
            />
          )}

          {step === 'mapping' && preview && (
            <MappingStep
              preview={preview}
              onBack={prevStep}
              onNext={nextStep}
            />
          )}

          {step === 'resolver' && preview && (
            <ResolverStep
              preview={preview}
              overrides={userOverrides}
              setOverrides={setUserOverrides}
              overwriteExisting={overwriteExisting}
              setOverwriteExisting={setOverwriteExisting}
              onBack={prevStep}
              onExecute={() => void executeImport()}
              busy={busy}
              hasUnmapped={preview.unmappedKonten.length > 0}
              hasExistingData={preview.warnings.some((w) =>
                w.toLowerCase().includes('existier'),
              )}
            />
          )}

          {step === 'confirm' && result && <ConfirmStep result={result} />}

          {error && (
            <div className="mt-4 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Sub-Steps
// ============================================================================

function UploadStep({
  fileName,
  onDrop,
  onFileChange,
  onNext,
  busy,
  ready,
}: {
  fileName: string;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onNext: () => void;
  busy: boolean;
  ready: boolean;
}) {
  const t = useTranslations();
  return (
    <div>
      <p className="text-sm text-slate-700 mb-4">{t('datevImport.upload.description')}</p>
      <div
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center bg-slate-50"
      >
        <p className="text-sm text-slate-600 mb-3">{t('datevImport.upload.dropzone')}</p>
        <label className="inline-block">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={onFileChange}
            className="hidden"
          />
          <span className="cursor-pointer inline-block px-4 py-2 bg-brand-600 text-white rounded text-sm hover:bg-brand-700">
            {t('datevImport.upload.chooseFile')}
          </span>
        </label>
        {fileName && (
          <p className="mt-3 text-xs text-slate-500">
            {t('datevImport.upload.selected')}: <strong>{fileName}</strong>
          </p>
        )}
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <button
          type="button"
          onClick={onNext}
          disabled={!ready || busy}
          className="px-4 py-2 bg-brand-600 text-white rounded text-sm hover:bg-brand-700 disabled:opacity-50"
        >
          {busy ? t('datevImport.upload.parsing') : t('common.next')}
        </button>
      </div>
    </div>
  );
}

function ParsePreviewStep({
  preview,
  fileName,
  onBack,
  onNext,
}: {
  preview: PreviewResponse;
  fileName: string;
  onBack: () => void;
  onNext: () => void;
}) {
  const t = useTranslations();
  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-900 mb-2">
        {t('datevImport.parsePreview.header')}
      </h3>
      <div className="rounded-md bg-slate-50 border border-slate-200 p-3 text-xs mb-4">
        <div>
          <strong>Formatname:</strong> {preview.parsed.formatName}
        </div>
        <div>
          <strong>Version:</strong> {preview.parsed.version}
        </div>
        <div>
          <strong>Berater/Mandant:</strong> {preview.parsed.beraternummer} /{' '}
          {preview.parsed.mandantennummer}
        </div>
        <div>
          <strong>Sachkontenlänge:</strong> {preview.parsed.sachkontenlaenge}
        </div>
        <div>
          <strong>Bezeichnung:</strong> {preview.parsed.bezeichnung}
        </div>
      </div>
      {preview.warnings.length > 0 && (
        <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-xs mb-4">
          <strong className="text-amber-900">{t('datevImport.warnings')}:</strong>
          <ul className="list-disc list-inside text-amber-800 mt-1">
            {preview.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-slate-500 mb-4">
        {t('datevImport.parsePreview.bookingsCount', {
          count: preview.saldovortrag.length,
        })}
      </p>
      <div className="flex justify-between gap-2">
        <button
          type="button"
          onClick={onBack}
          className="px-4 py-2 border border-slate-300 rounded text-sm text-slate-700 hover:bg-slate-50"
        >
          {t('common.back')}
        </button>
        <button
          type="button"
          onClick={onNext}
          className="px-4 py-2 bg-brand-600 text-white rounded text-sm hover:bg-brand-700"
        >
          {t('common.next')}
        </button>
      </div>
    </div>
  );
}

function SaldovortragStep({
  preview,
  onBack,
  onNext,
}: {
  preview: PreviewResponse;
  onBack: () => void;
  onNext: () => void;
}) {
  const t = useTranslations();
  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-900 mb-2">
        {t('datevImport.saldovortrag.title')}
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-2 py-1 text-left font-medium">{t('datevImport.columns.konto')}</th>
              <th className="px-2 py-1 text-right font-medium">{t('datevImport.columns.soll')}</th>
              <th className="px-2 py-1 text-right font-medium">{t('datevImport.columns.haben')}</th>
              <th className="px-2 py-1 text-right font-medium">{t('datevImport.columns.saldo')}</th>
              <th className="px-2 py-1 text-right font-medium">{t('datevImport.columns.buchungsCount')}</th>
            </tr>
          </thead>
          <tbody>
            {preview.saldovortrag.map((s) => (
              <tr key={s.konto} className="border-t border-slate-100">
                <td className="px-2 py-1 font-mono">{s.konto}</td>
                <td className="px-2 py-1 text-right num-de">
                  {s.soll.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
                </td>
                <td className="px-2 py-1 text-right num-de">
                  {s.haben.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
                </td>
                <td
                  className={
                    'px-2 py-1 text-right num-de font-semibold ' +
                    (s.saldo > 0 ? 'text-emerald-700' : s.saldo < 0 ? 'text-red-700' : '')
                  }
                >
                  {s.saldo.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
                </td>
                <td className="px-2 py-1 text-right">{s.buchungsCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex justify-between gap-2 mt-4">
        <button
          type="button"
          onClick={onBack}
          className="px-4 py-2 border border-slate-300 rounded text-sm text-slate-700 hover:bg-slate-50"
        >
          {t('common.back')}
        </button>
        <button
          type="button"
          onClick={onNext}
          className="px-4 py-2 bg-brand-600 text-white rounded text-sm hover:bg-brand-700"
        >
          {t('common.next')}
        </button>
      </div>
    </div>
  );
}

function MappingStep({
  preview,
  onBack,
  onNext,
}: {
  preview: PreviewResponse;
  onBack: () => void;
  onNext: () => void;
}) {
  const t = useTranslations();
  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-900 mb-2">
        {t('datevImport.mapping.title')}
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-2 py-1 text-left font-medium">{t('datevImport.columns.datevKonto')}</th>
              <th className="px-2 py-1 text-left font-medium">{t('datevImport.columns.hgbPosition')}</th>
              <th className="px-2 py-1 text-left font-medium">{t('datevImport.columns.kategorie')}</th>
              <th className="px-2 py-1 text-center font-medium">{t('datevImport.columns.confidence')}</th>
              <th className="px-2 py-1 text-center font-medium">{t('datevImport.columns.status')}</th>
            </tr>
          </thead>
          <tbody>
            {preview.mappedPositionen.map((p) => (
              <tr key={p.datevKonto} className="border-t border-slate-100">
                <td className="px-2 py-1 font-mono">{p.datevKonto}</td>
                <td className="px-2 py-1">
                  {p.mapping ? `${p.mapping.hgbPosition} ${p.mapping.hgbKontoNr}` : '—'}
                </td>
                <td className="px-2 py-1">{p.mapping?.kategorie ?? '—'}</td>
                <td className="px-2 py-1 text-center">
                  {p.mapping ? p.mapping.confidence.toFixed(2) : '—'}
                </td>
                <td className="px-2 py-1 text-center">
                  {p.autoMapped && (
                    <span className="inline-block px-1.5 py-0.5 rounded text-xs bg-emerald-100 text-emerald-800">
                      {t('datevImport.status.autoMapped')}
                    </span>
                  )}
                  {p.userOverride && (
                    <span className="inline-block px-1.5 py-0.5 rounded text-xs bg-blue-100 text-blue-800">
                      {t('datevImport.status.userOverride')}
                    </span>
                  )}
                  {!p.mapping && (
                    <span className="inline-block px-1.5 py-0.5 rounded text-xs bg-amber-100 text-amber-800">
                      {t('datevImport.status.unmapped')}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex justify-between gap-2 mt-4">
        <button
          type="button"
          onClick={onBack}
          className="px-4 py-2 border border-slate-300 rounded text-sm text-slate-700 hover:bg-slate-50"
        >
          {t('common.back')}
        </button>
        <button
          type="button"
          onClick={onNext}
          className="px-4 py-2 bg-brand-600 text-white rounded text-sm hover:bg-brand-700"
        >
          {t('common.next')}
        </button>
      </div>
    </div>
  );
}

function ResolverStep({
  preview,
  overrides,
  setOverrides,
  overwriteExisting,
  setOverwriteExisting,
  onBack,
  onExecute,
  busy,
  hasUnmapped,
  hasExistingData,
}: {
  preview: PreviewResponse;
  overrides: Record<string, string>;
  setOverrides: (o: Record<string, string>) => void;
  overwriteExisting: boolean;
  setOverwriteExisting: (v: boolean) => void;
  onBack: () => void;
  onExecute: () => void;
  busy: boolean;
  hasUnmapped: boolean;
  hasExistingData: boolean;
}) {
  const t = useTranslations();
  const knownHgbPositionen = [
    '1.', '4.', '5a.', '5b.', '6.', '6a.', '6b.', '7a.', '8.', '13.', '14.', '16.',
    'A.I.', 'A.II.', 'A.III.', 'A.IV.', 'B.IV.',
  ];
  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-900 mb-2">
        {t('datevImport.resolver.title')}
      </h3>
      {hasUnmapped ? (
        <p className="text-xs text-slate-600 mb-3">
          {t('datevImport.resolver.description', {
            count: preview.unmappedKonten.length,
          })}
        </p>
      ) : (
        <p className="text-xs text-emerald-700 mb-3">
          {t('datevImport.resolver.allMapped')}
        </p>
      )}
      {preview.unmappedKonten.map((konto) => (
        <div key={konto} className="flex items-center gap-3 mb-2">
          <span className="font-mono text-sm">{konto}</span>
          <span className="text-slate-500">→</span>
          <select
            value={overrides[konto] ?? ''}
            onChange={(e) =>
              setOverrides({ ...overrides, [konto]: e.target.value })
            }
            className="flex-1 px-2 py-1 border border-slate-300 rounded text-sm bg-white"
          >
            <option value="">— bitte wählen —</option>
            {knownHgbPositionen.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      ))}
      {hasExistingData && (
        <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded text-xs">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={overwriteExisting}
              onChange={(e) => setOverwriteExisting(e.target.checked)}
            />
            <span>{t('datevImport.resolver.overwriteExisting')}</span>
          </label>
        </div>
      )}
      <div className="flex justify-between gap-2 mt-6">
        <button
          type="button"
          onClick={onBack}
          className="px-4 py-2 border border-slate-300 rounded text-sm text-slate-700 hover:bg-slate-50"
        >
          {t('common.back')}
        </button>
        <button
          type="button"
          onClick={onExecute}
          disabled={busy || (hasUnmapped && !overwriteExisting && Object.keys(overrides).length === 0)}
          className="px-4 py-2 bg-emerald-600 text-white rounded text-sm hover:bg-emerald-700 disabled:opacity-50"
        >
          {busy ? t('datevImport.resolver.importing') : t('datevImport.resolver.import')}
        </button>
      </div>
    </div>
  );
}

function ConfirmStep({ result }: { result: ImportResult }) {
  const t = useTranslations();
  return (
    <div className="text-center py-6">
      <div className="text-5xl mb-3">✓</div>
      <h3 className="text-lg font-semibold text-emerald-700 mb-2">
        {t('datevImport.confirm.success')}
      </h3>
      <div className="text-sm text-slate-700 space-y-1">
        <p>
          <strong>{t('datevImport.confirm.imported')}:</strong> {result.importedCount}
        </p>
        <p>
          <strong>{t('datevImport.confirm.skipped')}:</strong> {result.skippedCount}
        </p>
        {result.bilanzId && (
          <p>
            <strong>{t('datevImport.confirm.bilanzId')}:</strong> {result.bilanzId}
          </p>
        )}
        {result.guvId && (
          <p>
            <strong>{t('datevImport.confirm.guvId')}:</strong> {result.guvId}
          </p>
        )}
        {result.overwriteWarned && (
          <p className="text-amber-700">
            ⚠ {t('datevImport.confirm.overwriteWarned')}
          </p>
        )}
      </div>
      {result.warnings.length > 0 && (
        <details className="mt-4 text-left">
          <summary className="text-xs text-slate-600 cursor-pointer">
            {t('datevImport.warnings')} ({result.warnings.length})
          </summary>
          <ul className="mt-2 list-disc list-inside text-xs text-slate-700">
            {result.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}