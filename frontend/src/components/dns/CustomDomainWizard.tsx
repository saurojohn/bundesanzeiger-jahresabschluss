'use client';

import { useState, useCallback, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { apiFetch, getAccessToken } from '@/lib/api';
import { resolveKanzleiId } from '@/lib/kanzlei';

const FQDN_REGEX =
  /^(?=.{4,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/;

/**
 * Custom-Domain-Wizard (M4 Sprint 3).
 *
 * 3-Schritte-Wizard für die Einrichtung einer Custom-Domain:
 *
 *   1. Domain eingeben (FQDN-Validierung)
 *   2. DNS-Verifikation starten (TXT-Record-Anweisung, ggf. Auto)
 *   3. Verifikation prüfen (Public DNS, Retry-Button)
 *
 * Lädt kanzleiId + initial customDomain + Feature-Flag selbst über
 * /api/auth/me. Voraussetzung: Tier PREMIUM (oder MOCK_DEV_MODE).
 *
 * Feature-Flag-Prüfung: einfach — wenn die Subscription-Tiers-Antwort
 * kein 'custom-domain' in den Features des aktuellen Tiers enthält,
 * wird der Wizard im Locked-State angezeigt.
 */
type WizardStep = 'input' | 'verify' | 'done';

interface VerificationResponse {
  verificationToken: string;
  txtRecordName: string;
  txtRecordValue: string;
  manualInstructions: string;
  autoCreated: boolean;
}

interface VerifyCheckResponse {
  verified: boolean;
  reason?: string;
  checkedAt: string;
}

export function CustomDomainWizard() {
  const t = useTranslations();
  const [kanzleiId, setKanzleiId] = useState<string | null>(null);
  const [initialDomain, setInitialDomain] = useState<string | null>(null);
  const [initialVerified, setInitialVerified] = useState(false);
  const [featureEnabled, setFeatureEnabled] = useState(false);
  const [ready, setReady] = useState(false);

  const [step, setStep] = useState<WizardStep>('input');
  const [domain, setDomain] = useState('');
  const [domainError, setDomainError] = useState<string | null>(null);
  const [verification, setVerification] = useState<VerificationResponse | null>(null);
  const [verifyResult, setVerifyResult] = useState<VerifyCheckResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ===========================================================================
  // Initial Load: kanzleiId + Branding + Subscription-Tier-Features
  // ===========================================================================
  useEffect(() => {
    async function load() {
      try {
        const token = getAccessToken();
        // Typannotation noetig: `token ? { Authorization: string } : {}`
        // inferiert sonst `{ Authorization?: undefined }`, was nicht zu
        // `Record<string, string>` passt (FetchOptions.headers).
        const headers: Record<string, string> = token
          ? { Authorization: `Bearer ${token}` }
          : {};

        // Bugfix 2026-09-29: `apiFetch` liefert den bereits geparsten JSON-Body,
        // KEIN `Response`. Das bisherige `res.ok` / `res.json()`-Handling
        // behandelte ein JSON-Objekt wie eine Response — `ok` ist dort immer
        // undefined und `json()` existiert nicht. Der Pfad konnte nie laufen.
        // Ausserdem landeten die Aufrufe unter /api/api/... (doppeltes Praefix).

        // kanzleiId via /mandant → /mandant/:id
        //
        // Bugfix 2026-10-05: `/auth/me` liefert mandanten OHNE kanzleiId.
        // `me.mandanten[0]?.kanzleiId` war damit immer undefined, und das
        // `return` brach den ganzen Ladevorgang ab — der Assistent blieb
        // dauerhaft leer. Dieselbe Annahme stand in SubscriptionView.
        const firstKanzlei = token ? await resolveKanzleiId(token) : null;
        if (!firstKanzlei) {
          return;
        }
        setKanzleiId(firstKanzlei);

        // Branding (für initial customDomain)
        const brand = await apiFetch<{
          customDomain: string | null;
          customDomainVerified: boolean;
        }>(`/branding/${firstKanzlei}`, { headers });
        setInitialDomain(brand.customDomain);
        setInitialVerified(brand.customDomainVerified);
        if (brand.customDomain) {
          setDomain(brand.customDomain);
        }
        if (brand.customDomainVerified) {
          setStep('done');
        }

        // Subscription-Tier → Feature-Flag. `apiFetch` wirft bei Fehlern,
        // deshalb eigener try/catch: ohne Subscription-Endpoint (Dev ohne
        // Stripe) soll das Feature trotzdem freigeschaltet bleiben.
        try {
          const sub = await apiFetch<{ features: readonly string[] }>(
            `/subscription/${firstKanzlei}`,
            { headers },
          );
          setFeatureEnabled(sub.features.includes('custom-domain'));
        } catch {
          // Kein Subscription-Endpoint → wir erlauben (Dev ohne Stripe-Setup)
          setFeatureEnabled(true);
        }
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setReady(true);
      }
    }
    void load();
  }, []);

  const startVerification = useCallback(async () => {
    if (!kanzleiId) return;
    setDomainError(null);
    setError(null);
    if (!FQDN_REGEX.test(domain)) {
      setDomainError(t('customDomain.invalidDomain'));
      return;
    }
    setLoading(true);
    try {
      const token = getAccessToken();
      const data = await apiFetch<VerificationResponse>(
        `/dns/${kanzleiId}/start-verification`,
        {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ customDomain: domain }),
      });
      setVerification(data);
      setStep('verify');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [domain, kanzleiId, t]);

  const checkVerification = useCallback(async () => {
    if (!kanzleiId) return;
    setError(null);
    setLoading(true);
    try {
      const token = getAccessToken();
      const data = await apiFetch<VerifyCheckResponse>(`/dns/${kanzleiId}/verify`, {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      setVerifyResult(data);
      if (data.verified) {
        setStep('done');
        setInitialVerified(true);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [kanzleiId]);

  // ===========================================================================
  // Render: Loading
  // ===========================================================================
  if (!ready) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <p className="text-sm text-slate-600">{t('customDomain.loading')}</p>
      </div>
    );
  }

  // ===========================================================================
  // Render: Feature deaktiviert (Tier < PREMIUM)
  // ===========================================================================
  if (!featureEnabled) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6">
        <div className="flex items-start gap-3">
          <svg
            className="h-6 w-6 flex-none text-amber-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div>
            <h3 className="text-base font-semibold text-amber-900">
              {t('customDomain.featureLockedTitle')}
            </h3>
            <p className="mt-2 text-sm text-amber-800">
              {t('customDomain.featureLockedDescription')}
            </p>
            <a
              href="/einstellungen/subscription"
              className="mt-3 inline-block rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
            >
              {t('customDomain.upgradeCta')}
            </a>
          </div>
        </div>
      </div>
    );
  }

  // ===========================================================================
  // Render: Done
  // ===========================================================================
  if (step === 'done' && (initialVerified || verifyResult?.verified)) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-6">
        <div className="flex items-start gap-3">
          <svg
            className="h-6 w-6 flex-none text-green-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
          <div>
            <h3 className="text-base font-semibold text-green-900">
              {t('customDomain.verifiedTitle')}
            </h3>
            <p className="mt-2 text-sm text-green-800">
              {t('customDomain.verifiedDescription', {
                domain: initialDomain ?? domain,
              })}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ===========================================================================
  // Render: Wizard
  // ===========================================================================
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="text-base font-semibold text-slate-900">
        {t('customDomain.wizardTitle')}
      </h3>
      <p className="mt-1 text-sm text-slate-600">
        {t('customDomain.wizardSubtitle')}
      </p>

      {/* Stepper */}
      <ol className="mt-6 flex items-center gap-4">
        {[
          { id: 'input', label: t('customDomain.step1Label') },
          { id: 'verify', label: t('customDomain.step2Label') },
          { id: 'done', label: t('customDomain.step3Label') },
        ].map((s, idx) => {
          const active =
            (s.id === 'input' && step === 'input') ||
            (s.id === 'verify' && step === 'verify') ||
            (s.id === 'done' && step === 'done');
          const done =
            (s.id === 'input' && (step === 'verify' || step === 'done')) ||
            (s.id === 'verify' && step === 'done');
          return (
            <li key={s.id} className="flex items-center gap-2">
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium ${
                  done
                    ? 'bg-green-100 text-green-700'
                    : active
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-slate-100 text-slate-500'
                }`}
              >
                {done ? '✓' : idx + 1}
              </span>
              <span
                className={`text-sm ${
                  active ? 'font-medium text-slate-900' : 'text-slate-600'
                }`}
              >
                {s.label}
              </span>
            </li>
          );
        })}
      </ol>

      {/* Step 1: Domain-Eingabe */}
      {step === 'input' && (
        <div className="mt-6">
          <label
            htmlFor="custom-domain-input"
            className="block text-sm font-medium text-slate-700"
          >
            {t('customDomain.domainLabel')}
          </label>
          <input
            id="custom-domain-input"
            type="text"
            value={domain}
            onChange={(e) => {
              setDomain(e.target.value);
              setDomainError(null);
            }}
            placeholder="rechnungen.musterkanzlei.de"
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          {domainError && (
            <p className="mt-2 text-sm text-red-600">{domainError}</p>
          )}
          <button
            type="button"
            onClick={startVerification}
            disabled={loading || !domain}
            className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading
              ? t('customDomain.startingVerification')
              : t('customDomain.startVerification')}
          </button>
        </div>
      )}

      {/* Step 2: DNS-Verifikation */}
      {step === 'verify' && verification && (
        <div className="mt-6">
          <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
            <h4 className="text-sm font-semibold text-slate-900">
              {t('customDomain.dnsInstructionsTitle')}
            </h4>
            <pre className="mt-3 overflow-x-auto whitespace-pre rounded bg-slate-900 p-3 text-xs text-slate-100">
{`Typ:    TXT
Name:   ${verification.txtRecordName}
Wert:   ${verification.txtRecordValue}
TTL:    300`}
            </pre>
            {verification.autoCreated ? (
              <p className="mt-3 text-xs text-green-700">
                ✓ {t('customDomain.autoCreatedHint')}
              </p>
            ) : (
              <p className="mt-3 text-xs text-amber-700">
                ⚠ {t('customDomain.manualEntryHint')}
              </p>
            )}
          </div>

          <p className="mt-4 text-xs text-slate-500">
            {t('customDomain.propagationHint')}
          </p>

          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={checkVerification}
              disabled={loading}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading
                ? t('customDomain.checking')
                : t('customDomain.checkVerification')}
            </button>
            <button
              type="button"
              onClick={() => setStep('input')}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              {t('customDomain.back')}
            </button>
          </div>

          {verifyResult && !verifyResult.verified && (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3">
              <p className="text-sm text-red-800">
                {verifyResult.reason ?? t('customDomain.verificationFailed')}
              </p>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}
    </div>
  );
}