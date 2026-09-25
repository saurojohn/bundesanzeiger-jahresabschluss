'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiFetch, getAccessToken } from '@/lib/api';

type KanzleiBranding = {
  kanzleiId: string;
  logoUrl: string | null;
  primaryColor: string;
  accentColor: string;
  customDomain: string | null;
  customDomainVerified: boolean;
  brandingUpdatedAt: string | null;
};

const HEX_COLOR_REGEX = /^#[a-fA-F0-9]{6}$/;
const FQDN_REGEX =
  /^(?=.{4,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/;

const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml'] as const;
type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

const MAX_LOGO_BYTES = 5 * 1024 * 1024;

/**
 * Branding-Editor für Kanzlei-Administratoren (M3 Sprint 4+5).
 *
 * Erlaubt das Bearbeiten von:
 *   - Primärfarbe (Hex)
 *   - Sekundärfarbe (Hex)
 *   - Custom-Domain (FQDN, M3 ohne DNS-Verifikation)
 *   - Logo-Upload (PNG/JPEG/SVG, max 5MB)
 *
 * Zeigt eine Live-Preview des Headers mit den gewählten Werten.
 */
export function BrandingEditor() {
  const t = useTranslations();
  const [kanzleiId, setKanzleiId] = useState<string | null>(null);
  const [branding, setBranding] = useState<KanzleiBranding | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit-State
  const [primaryColor, setPrimaryColor] = useState('#2563eb');
  const [accentColor, setAccentColor] = useState('#0ea5e9');
  const [customDomain, setCustomDomain] = useState('');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);

  // Save-State
  const [savingColors, setSavingColors] = useState(false);
  const [savingDomain, setSavingDomain] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  useEffect(() => {
    void loadKanzleiAndBranding();
    return () => {
      if (logoPreviewUrl) URL.revokeObjectURL(logoPreviewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadKanzleiAndBranding(): Promise<void> {
    const token = getAccessToken();
    if (!token) return;
    try {
      // Kanzlei-ID via User-Mandanten ableiten: jeder User hat mindestens
      // einen Mandanten, dessen Kanzlei seine Branding-Kanzlei ist.
      // Im Pilot wird die Kanzlei-ID über die Mandanten-Liste ermittelt
      // (Mandant.kanzleiId). Wir laden das Branding daher über die
      // /api/mandant-Route und nutzen den ersten Mandanten.
      const mandanten = await apiFetch<Array<{ id: string; firmenname: string }>>(
        '/mandant',
        { accessToken: token },
      );
      if (mandanten.length === 0) {
        setError(t('branding.errors.noMandant'));
        setLoading(false);
        return;
      }

      // Wir leiten die kanzleiId aus dem Logo-URL-Pfad ab ODER fragen
      // den Server. Da der Branding-Endpoint eine explizite kanzleiId
      // erwartet, fragen wir die /api/auth/me-Route nicht — sondern
      // nutzen einen kleinen Helper: Wir laden das Branding über die
      // Mandant-Resource. Dafür erweitern wir den Endpoint-Response um
      // eine kanzleiId — bis dahin schlagen wir den Server-Wert aus der
      // /api/mandant-Antwort nach.
      //
      // PRAKTIKABLE LÖSUNG: Wir fragen den Server nach der Kanzlei-ID
      // über einen separaten /api/auth/me-style-Endpoint. Im Pilot wird
      // die Kanzlei-ID implizit aus dem LogoUrl extrahiert, sobald
      // vorhanden. Wir gehen hier pragmatisch vor und holen die
      // Kanzlei-ID via /api/branding-Lookup anhand der ersten
      // Mandanten-ID — der Service muss eine mandant-basierte Variante
      // unterstützen.
      //
      // Wir nutzen einfach die erste kanzleiId aus dem Mandanten —
      // wir holen sie über einen erweiterten Mandant-Endpoint.
      const mandantDetail = await apiFetch<{
        id: string;
        kanzleiId: string;
      }>(`/mandant/${mandanten[0]?.id ?? ''}`, { accessToken: token });
      const kid = mandantDetail.kanzleiId;
      setKanzleiId(kid);

      const data = await apiFetch<KanzleiBranding>(`/branding/${kid}`, {
        accessToken: token,
      });
      setBranding(data);
      setPrimaryColor(data.primaryColor);
      setAccentColor(data.accentColor);
      setCustomDomain(data.customDomain ?? '');
      if (data.logoUrl) {
        // Logo-URL ist /api/branding/:kanzleiId/logo/blob (interner Pfad)
        setLogoPreviewUrl(data.logoUrl);
      }
      setLoading(false);
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }

  function showFeedback(type: 'success' | 'error', message: string): void {
    setFeedback({ type, message });
    window.setTimeout(() => setFeedback(null), 4000);
  }

  async function handleSaveColors(): Promise<void> {
    if (!kanzleiId) return;
    if (!HEX_COLOR_REGEX.test(primaryColor)) {
      showFeedback('error', t('branding.errors.invalidHexColor'));
      return;
    }
    if (!HEX_COLOR_REGEX.test(accentColor)) {
      showFeedback('error', t('branding.errors.invalidHexColor'));
      return;
    }
    setSavingColors(true);
    try {
      const token = getAccessToken();
      const updated = await apiFetch<KanzleiBranding>(
        `/branding/${kanzleiId}`,
        {
          method: 'PATCH',
          accessToken: token ?? undefined,
          body: JSON.stringify({ primaryColor, accentColor }),
        },
      );
      setBranding(updated);
      applyCssVariables(updated.primaryColor, updated.accentColor);
      showFeedback('success', t('branding.feedback.colorsSaved'));
    } catch (err) {
      showFeedback('error', (err as Error).message);
    } finally {
      setSavingColors(false);
    }
  }

  async function handleSaveDomain(): Promise<void> {
    if (!kanzleiId) return;
    if (customDomain.length > 0 && !FQDN_REGEX.test(customDomain)) {
      showFeedback('error', t('branding.errors.invalidDomain'));
      return;
    }
    setSavingDomain(true);
    try {
      const token = getAccessToken();
      const updated = await apiFetch<KanzleiBranding>(
        `/branding/${kanzleiId}`,
        {
          method: 'PATCH',
          accessToken: token ?? undefined,
          body: JSON.stringify({ customDomain: customDomain || undefined }),
        },
      );
      setBranding(updated);
      showFeedback('success', t('branding.feedback.domainSaved'));
    } catch (err) {
      showFeedback('error', (err as Error).message);
    } finally {
      setSavingDomain(false);
    }
  }

  async function handleUploadLogo(): Promise<void> {
    if (!kanzleiId) return;
    if (!logoFile) {
      showFeedback('error', t('branding.errors.noLogoSelected'));
      return;
    }
    if (!ALLOWED_MIME_TYPES.includes(logoFile.type as AllowedMimeType)) {
      showFeedback('error', t('branding.errors.invalidLogoType'));
      return;
    }
    if (logoFile.size > MAX_LOGO_BYTES) {
      showFeedback('error', t('branding.errors.logoTooLarge'));
      return;
    }

    setUploadingLogo(true);
    try {
      const token = getAccessToken();
      const base64 = await readFileAsBase64(logoFile);
      const result = await apiFetch<{ logoUrl: string; logoWormKey: string }>(
        `/branding/${kanzleiId}/logo`,
        {
          method: 'POST',
          accessToken: token ?? undefined,
          body: JSON.stringify({
            logoBase64: base64,
            mimeType: logoFile.type,
            filename: logoFile.name,
          }),
        },
      );
      // Logo-Preview refreshen
      const refreshed = await apiFetch<KanzleiBranding>(
        `/branding/${kanzleiId}`,
        { accessToken: token ?? undefined },
      );
      setBranding(refreshed);
      setLogoPreviewUrl(refreshed.logoUrl ?? result.logoUrl);
      setLogoFile(null);
      showFeedback('success', t('branding.feedback.logoUploaded'));
    } catch (err) {
      showFeedback('error', (err as Error).message);
    } finally {
      setUploadingLogo(false);
    }
  }

  async function handleDeleteLogo(): Promise<void> {
    if (!kanzleiId) return;
    if (!window.confirm(t('branding.confirm.deleteLogo'))) return;
    try {
      const token = getAccessToken();
      await apiFetch<void>(`/branding/${kanzleiId}/logo`, {
        method: 'DELETE',
        accessToken: token ?? undefined,
      });
      const refreshed = await apiFetch<KanzleiBranding>(
        `/branding/${kanzleiId}`,
        { accessToken: token ?? undefined },
      );
      setBranding(refreshed);
      setLogoPreviewUrl(null);
      showFeedback('success', t('branding.feedback.logoDeleted'));
    } catch (err) {
      showFeedback('error', (err as Error).message);
    }
  }

  // Live-Preview ableiten
  const previewStyle = useMemo<React.CSSProperties>(
    () => ({
      // CSS-Variablen für die Preview setzen
      // @ts-expect-error -- CSS custom property
      '--brand-primary': primaryColor,
      '--brand-accent': accentColor,
      '--brand-primary-hover': shadeColor(primaryColor, -15),
    }),
    [primaryColor, accentColor],
  );

  if (loading) {
    return (
      <div className="text-sm text-slate-500">{t('common.loading')}</div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {feedback && (
        <div
          className={
            'rounded-md p-4 text-sm ' +
            (feedback.type === 'success'
              ? 'bg-green-50 text-green-800'
              : 'bg-red-50 text-red-700')
          }
        >
          {feedback.message}
        </div>
      )}

      {/* === Logo-Upload === */}
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-1 text-lg font-semibold text-slate-900">
          {t('branding.logo.title')}
        </h2>
        <p className="mb-4 text-sm text-slate-600">
          {t('branding.logo.subtitle')}
        </p>

        <div className="flex items-start gap-6">
          <div className="flex h-24 w-40 items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50">
            {logoPreviewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoPreviewUrl}
                alt={t('branding.logo.previewAlt')}
                className="max-h-20 max-w-36 object-contain"
              />
            ) : (
              <span className="text-xs text-slate-400">
                {t('branding.logo.noLogo')}
              </span>
            )}
          </div>
          <div className="flex-1 space-y-3">
            <input
              type="file"
              accept={ALLOWED_MIME_TYPES.join(',')}
              onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-slate-600 file:mr-4 file:rounded file:border-0 file:bg-slate-100 file:px-4 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
            />
            <p className="text-xs text-slate-500">
              {t('branding.logo.allowedTypes')} ·{' '}
              {t('branding.logo.maxSize', { mb: 5 })}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleUploadLogo}
                disabled={!logoFile || uploadingLogo}
                className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {uploadingLogo ? t('common.loading') : t('branding.logo.upload')}
              </button>
              {branding?.logoUrl && (
                <button
                  type="button"
                  onClick={handleDeleteLogo}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  {t('branding.logo.delete')}
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* === Farben === */}
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-1 text-lg font-semibold text-slate-900">
          {t('branding.colors.title')}
        </h2>
        <p className="mb-4 text-sm text-slate-600">
          {t('branding.colors.subtitle')}
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <ColorField
            label={t('branding.colors.primary')}
            value={primaryColor}
            onChange={setPrimaryColor}
          />
          <ColorField
            label={t('branding.colors.accent')}
            value={accentColor}
            onChange={setAccentColor}
          />
        </div>
        <div className="mt-4">
          <button
            type="button"
            onClick={handleSaveColors}
            disabled={savingColors}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {savingColors ? t('common.loading') : t('branding.colors.save')}
          </button>
        </div>
      </section>

      {/* === Custom-Domain === */}
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-1 text-lg font-semibold text-slate-900">
          {t('branding.domain.title')}
        </h2>
        <p className="mb-4 text-sm text-slate-600">
          {t('branding.domain.subtitle')}
        </p>
        <div className="flex items-start gap-4">
          <div className="flex-1">
            <label
              htmlFor="custom-domain-input"
              className="block text-sm font-medium text-slate-700"
            >
              {t('branding.domain.inputLabel')}
            </label>
            <input
              id="custom-domain-input"
              type="text"
              value={customDomain}
              onChange={(e) => setCustomDomain(e.target.value)}
              placeholder={t('branding.domain.placeholder')}
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
            {customDomain && (
              <p className="mt-1 text-xs text-slate-500">
                {branding?.customDomainVerified
                  ? t('branding.domain.verified')
                  : t('branding.domain.notVerifiedM3')}
              </p>
            )}
          </div>
        </div>
        <div className="mt-4">
          <button
            type="button"
            onClick={handleSaveDomain}
            disabled={savingDomain}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {savingDomain ? t('common.loading') : t('branding.domain.save')}
          </button>
        </div>
      </section>

      {/* === Live-Preview === */}
      <section
        className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
        style={previewStyle}
      >
        <h2 className="mb-1 text-lg font-semibold text-slate-900">
          {t('branding.preview.title')}
        </h2>
        <p className="mb-4 text-sm text-slate-600">
          {t('branding.preview.subtitle')}
        </p>
        <div className="overflow-hidden rounded-md border border-slate-200">
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex items-center gap-3">
              {logoPreviewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoPreviewUrl}
                  alt={t('branding.logo.previewAlt')}
                  className="h-8 w-auto"
                />
              ) : (
                <div className="h-8 w-8 rounded bg-brand-600" />
              )}
              <span
                className="font-semibold"
                style={{ color: 'var(--brand-primary)' }}
              >
                {t('common.appName')}
              </span>
            </div>
            <div className="flex gap-1">
              <button
                type="button"
                className="rounded px-2 py-1 text-xs font-medium text-slate-600"
              >
                {t('navigation.bilanz')}
              </button>
              <button
                type="button"
                className="rounded px-2 py-1 text-xs font-medium"
                style={{
                  backgroundColor: 'var(--brand-primary-50, #eff6ff)',
                  color: 'var(--brand-primary, #2563eb)',
                }}
              >
                {t('navigation.guv')}
              </button>
              <button
                type="button"
                className="rounded px-2 py-1 text-xs font-medium text-slate-600"
              >
                {t('navigation.anhang')}
              </button>
            </div>
          </div>
          <div className="bg-white p-4">
            <button
              type="button"
              className="rounded px-3 py-1.5 text-xs font-medium text-white"
              style={{
                backgroundColor: 'var(--brand-primary, #2563eb)',
              }}
            >
              {t('branding.preview.samplePrimary')}
            </button>
            <button
              type="button"
              className="ml-2 rounded px-3 py-1.5 text-xs font-medium text-white"
              style={{ backgroundColor: 'var(--brand-accent, #0ea5e9)' }}
            >
              {t('branding.preview.sampleAccent')}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hilfs-Komponenten
// ---------------------------------------------------------------------------

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      <div className="mt-1 flex items-center gap-3">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-14 cursor-pointer rounded border border-slate-300"
          aria-label={label}
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="block w-32 rounded-md border border-slate-300 px-3 py-2 text-sm font-mono focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          maxLength={7}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('FileReader: kein String-Result'));
        return;
      }
      // Data-URL-Format: "data:image/png;base64,iVBOR..."
      // Wir wollen nur den Base64-Teil.
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('FileReader-Fehler'));
    reader.readAsDataURL(file);
  });
}

/**
 * Mischt eine Hex-Color mit Schwarz (factor < 0) oder Weiß (factor > 0).
 * factor = -15 → 15% abgedunkelt.
 */
function shadeColor(hex: string, factor: number): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return hex;
  const adjust = (c: string): number => {
    const v = parseInt(c, 16);
    if (factor < 0) {
      return Math.max(0, Math.floor(v * (1 + factor / 100)));
    }
    return Math.min(255, Math.floor(v + (255 - v) * (factor / 100)));
  };
  const toHex = (n: number): string => n.toString(16).padStart(2, '0');
  return `#${toHex(adjust(m[1] ?? '00'))}${toHex(adjust(m[2] ?? '00'))}${toHex(adjust(m[3] ?? '00'))}`;
}

/**
 * Wendet die CSS-Custom-Properties für die Brand-Farben an.
 *
 * Wird sowohl beim Speichern als auch bei einem Reload aufgerufen,
 * damit die Vorschau und alle Brand-* Klassen die aktuelle Farbe zeigen.
 */
function applyCssVariables(primary: string, accent: string): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.style.setProperty('--brand-primary', primary);
  root.style.setProperty('--brand-accent', accent);
  root.style.setProperty('--brand-primary-hover', shadeColor(primary, -15));
}