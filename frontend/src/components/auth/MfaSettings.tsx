'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiFetch, getAccessToken } from '@/lib/api';

/**
 * MFA-Einrichtung (TOTP) in den Benutzereinstellungen.
 *
 * BEFUND 2026-10-19 (Nachtrag 48, TODO-8.20): Die Routen
 * `/auth/totp/setup`, `/auth/totp/enable` und `/auth/totp/disable` waren
 * vorhanden, korrekt abgesichert — und **von der Oberflaeche aus nicht
 * erreichbar**. `grep -rn "totp" frontend/src` fand nur die Verwendung
 * im Login (der Client sendet `totpCode`).
 *
 * Das ist die schlimmste Art von Luecke: Die Funktion existiert, sie ist
 * korrekt, und **niemand kann sie benutzen**. Wer MFA aktivieren will,
 * musste die Route von Hand aufrufen.
 *
 * Zwei Details, die aus dem Backend kommen und hier nicht erfunden werden:
 *
 * 1. `/auth/totp/enable` verlangt seit Nachtrag 48 **das Passwort**
 *    (erneute Authentifizierung) — sonst koennte jemand mit einem
 *    gestohlenen JWT das MFA des Opfers uebernehmen und es dauerhaft
 *    aussperren. Deshalb wird hier nach dem Passwort gefragt.
 * 2. `/auth/totp/disable` verlangt **Passwort und TOTP-Code**. Wer MFA
 *    deaktiviert, muss beides liefern — ein verliertes Authenticator-Geraet
 *    ist also kein Weg aus dem Konto heraus, sondern braucht den Admin.
 *
 * Der Dialog fuer das Deaktivieren entspricht deshalb genau dem Dialog der
 * Backend-Regel: Passwort **und** Code.
 */

type SetupAntwort = {
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
};

export function MfaSettings() {
  const t = useTranslations();
  const [totpAktiv, setTotpAktiv] = useState<boolean | null>(null);
  const [email, setEmail] = useState('');
  const [laedt, setLaedt] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  const [hinweis, setHinweis] = useState<string | null>(null);

  // Dialogzustand
  const [dialog, setDialog] = useState<'einrichten' | 'deaktivieren' | null>(null);
  const [setup, setSetup] = useState<SetupAntwort | null>(null);
  const [code, setCode] = useState('');
  const [passwort, setPasswort] = useState('');
  const [sendet, setSendet] = useState(false);

  useEffect(() => {
    void statusLaden();
  }, []);

  async function statusLaden() {
    setLaedt(true);
    setFehler(null);
    try {
      const token = getAccessToken();
      if (!token) return;
      const me = await apiFetch<{ totpEnabled: boolean; email: string }>('/auth/me', {
        accessToken: token,
      });
      setTotpAktiv(Boolean(me.totpEnabled));
      setEmail(me.email ?? '');
    } catch (err) {
      setFehler(err instanceof Error ? err.message : t('errors.network.message'));
    } finally {
      setLaedt(false);
    }
  }

  async function einrichtenOeffnen() {
    setFehler(null);
    setHinweis(null);
    setCode('');
    setPasswort('');
    setSetup(null);
    setDialog('einrichten');
    try {
      const token = getAccessToken();
      if (!token) return;
      const data = await apiFetch<SetupAntwort>('/auth/totp/setup', {
        method: 'POST',
        accessToken: token,
      });
      setSetup(data);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : t('errors.network.message'));
      setDialog(null);
    }
  }

  async function absenden() {
    if (!setup && dialog === 'einrichten') return;
    setSendet(true);
    setFehler(null);
    setHinweis(null);
    try {
      const token = getAccessToken();
      if (!token) return;
      if (dialog === 'einrichten') {
        await apiFetch<{ success: true }>('/auth/totp/enable', {
          method: 'POST',
          accessToken: token,
          body: JSON.stringify({ secret: setup!.secret, code, password: passwort }),
        });
        setHinweis(t('auth.mfa.enabled'));
        setTotpAktiv(true);
        setDialog(null);
      } else {
        await apiFetch<{ success: true }>('/auth/totp/disable', {
          method: 'POST',
          accessToken: token,
          body: JSON.stringify({ email, password: passwort, code }),
        });
        setHinweis(t('auth.mfa.disabled'));
        setTotpAktiv(false);
        setDialog(null);
      }
    } catch (err) {
      setFehler(err instanceof Error ? err.message : t('errors.network.message'));
    } finally {
      setSendet(false);
    }
  }

  if (laedt) {
    return <div className="text-sm text-slate-500">{t('common.loading')}</div>;
  }

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-6">
      <h2 className="text-base font-semibold text-slate-900">{t('auth.mfa.title')}</h2>
      <p className="mt-1 text-sm text-slate-600">{t('auth.mfa.description')}</p>

      <div className="mt-4 flex items-center gap-3">
        <span
          className={
            'inline-flex px-2 py-0.5 rounded text-xs font-medium ' +
            (totpAktiv
              ? 'bg-emerald-100 text-emerald-800'
              : 'bg-amber-100 text-amber-800')
          }
          data-testid="mfa-status"
        >
          {totpAktiv ? t('auth.mfa.active') : t('auth.mfa.inactive')}
        </span>

        {totpAktiv ? (
          <button
            type="button"
            onClick={() => {
              setFehler(null);
              setHinweis(null);
              setCode('');
              setPasswort('');
              setDialog('deaktivieren');
            }}
            data-testid="mfa-deaktivieren"
            className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
          >
            {t('auth.mfa.disable')}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void einrichtenOeffnen()}
            data-testid="mfa-einrichten"
            className="rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
          >
            {t('auth.mfa.enable')}
          </button>
        )}
      </div>

      {fehler && (
        <div
          role="alert"
          className="mt-3 rounded-md bg-red-50 border border-red-200 p-2 text-xs text-red-700"
        >
          {fehler}
        </div>
      )}
      {hinweis && (
        <div className="mt-3 rounded-md bg-emerald-50 border border-emerald-200 p-2 text-xs text-emerald-800">
          {hinweis}
        </div>
      )}

      {dialog && (
        <div className="fixed inset-0 bg-slate-900 bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6">
            <h3 className="text-lg font-semibold text-slate-900">
              {dialog === 'einrichten'
                ? t('auth.mfa.enableTitle')
                : t('auth.mfa.disableTitle')}
            </h3>

            {dialog === 'einrichten' && (
              <>
                <p className="mt-2 text-sm text-slate-600">
                  {t('auth.mfa.setupHint')}
                </p>
                {setup ? (
                  <div className="mt-4 flex gap-4">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={setup.qrCodeDataUrl}
                      alt={t('auth.mfa.qrAlt')}
                      className="h-40 w-40 rounded border border-slate-200"
                    />
                    <div className="text-xs text-slate-600">
                      <p className="font-medium">{t('auth.mfa.secretLabel')}</p>
                      <p className="mt-1 font-mono break-all">{setup.secret}</p>
                    </div>
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-slate-500">
                    {t('common.loading')}
                  </p>
                )}
              </>
            )}

            {dialog === 'deaktivieren' && (
              <p className="mt-2 text-sm text-slate-600">
                {t('auth.mfa.disableHint')}
              </p>
            )}

            <div className="mt-4 space-y-3">
              <div>
                <label
                  htmlFor="mfa-code"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  {t('auth.mfa.code')}
                </label>
                <input
                  id="mfa-code"
                  name="mfa-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="w-40 rounded-md border border-slate-300 px-3 py-2 text-sm num-de"
                />
              </div>
              <div>
                <label
                  htmlFor="mfa-password"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  {t('auth.mfa.password')}
                </label>
                <input
                  id="mfa-password"
                  name="mfa-password"
                  type="password"
                  autoComplete="current-password"
                  value={passwort}
                  onChange={(e) => setPasswort(e.target.value)}
                  className="w-64 rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDialog(null)}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={() => void absenden()}
                disabled={sendet || code.length < 6 || passwort.length < 8}
                data-testid="mfa-absenden"
                className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {sendet ? t('common.loading') : t('auth.mfa.submit')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
