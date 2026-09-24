'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiFetch, getAccessToken } from '@/lib/api';

type KonsolidierungEinheit = {
  id: string;
  mutterMandantId: string;
  tochterMandantIds: string[];
  geschaeftsjahr: number;
  beteiligungsquote: number;
  konsolidierungsArt: string;
  status: 'DRAFT' | 'IN_PROGRESS' | 'COMPLETED' | 'VALIDATED';
  konzernBilanzId: string | null;
  konzernGuvId: string | null;
  buchungen: KonsolidierungsBuchung[];
};

type KonsolidierungsBuchung = {
  id: string;
  einheitId: string;
  buchungsArt: string;
  beschreibung: string;
  kontoSoll: string;
  kontoHaben: string;
  betrag: number;
  mandantId: string | null;
  reihenfolge: number;
  istAutomatisch: boolean;
};

type KonzernSalden = {
  konzernAktivaSumme: number;
  konzernPassivaSumme: number;
  konzernBilanzDifferenz: number;
  konzernGuVErgebnis: number;
  eigenkapitalQuoteKonzern: number;
  goodwill: number;
  badwill: number;
};

type Mandant = {
  id: string;
  firmenname: string;
};

const KONSOLIDIERUNGS_ARTEN = [
  'VOLLKONSOLIDIERUNG',
  'QUOTAL',
  'AT_EQUITY',
] as const;

type WizardStep = 'LIST' | 'MUTTER' | 'TOCHTER' | 'DETAILS' | 'VORSCHAU' | 'RESULT';

export function KonsolidierungView() {
  const t = useTranslations();
  const [einheiten, setEinheiten] = useState<KonsolidierungEinheit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<WizardStep>('LIST');
  const [mandanten, setMandanten] = useState<Mandant[]>([]);
  const [mutterId, setMutterId] = useState<string>('');
  const [tochterIds, setTochterIds] = useState<string[]>([]);
  const [geschaeftsjahr, setGeschaeftsjahr] = useState<number>(
    new Date().getFullYear() - 1,
  );
  const [beteiligungsquote, setBeteiligungsquote] = useState<number>(100);
  const [konsolidierungsArt, setKonsolidierungsArt] = useState<string>(
    'VOLLKONSOLIDIERUNG',
  );
  const [activeEinheit, setActiveEinheit] = useState<KonsolidierungEinheit | null>(
    null,
  );
  const [vorschauBuchungen, setVorschauBuchungen] = useState<KonsolidierungsBuchung[]>(
    [],
  );
  const [salden, setSalden] = useState<KonzernSalden | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void loadMandanten();
    void loadEinheiten();
  }, []);

  async function loadMandanten() {
    const token = getAccessToken();
    if (!token) return;
    try {
      const data = await apiFetch<Mandant[]>('/mandant', { accessToken: token });
      setMandanten(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.network.message'));
    }
  }

  async function loadEinheiten() {
    setLoading(true);
    setError(null);
    try {
      const token = getAccessToken();
      if (!token) return;
      const data = await apiFetch<KonsolidierungEinheit[]>(
        '/konsolidierung/einheiten',
        { accessToken: token },
      );
      setEinheiten(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.network.message'));
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    if (!mutterId || tochterIds.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const token = getAccessToken();
      if (!token) return;
      const einheit = await apiFetch<KonsolidierungEinheit>(
        '/konsolidierung/einheiten',
        {
          method: 'POST',
          accessToken: token,
          body: JSON.stringify({
            mutterMandantId: mutterId,
            tochterMandantIds: tochterIds,
            geschaeftsjahr,
            beteiligungsquote,
            konsolidierungsArt,
          }),
        },
      );
      setActiveEinheit(einheit);
      setStep('VORSCHAU');
      void loadEinheiten();
      await handleCalculate(einheit.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.network.message'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCalculate(einheitId: string) {
    try {
      const token = getAccessToken();
      if (!token) return;
      const buchungen = await apiFetch<KonsolidierungsBuchung[]>(
        `/konsolidierung/einheiten/${einheitId}/calculate`,
        { method: 'POST', accessToken: token },
      );
      setVorschauBuchungen(buchungen);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.network.message'));
    }
  }

  async function handleApply(einheitId: string) {
    setSubmitting(true);
    setError(null);
    try {
      const token = getAccessToken();
      if (!token) return;
      const result = await apiFetch<{
        konzernBilanzId: string;
        konzernGuvId: string;
        salden: KonzernSalden;
      }>(`/konsolidierung/einheiten/${einheitId}/apply`, {
        method: 'POST',
        accessToken: token,
      });
      setSalden(result.salden);
      setStep('RESULT');
      void loadEinheiten();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.network.message'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleFinalize(einheitId: string) {
    try {
      const token = getAccessToken();
      if (!token) return;
      await apiFetch<void>(`/konsolidierung/einheiten/${einheitId}/finalize`, {
        method: 'POST',
        accessToken: token,
      });
      void loadEinheiten();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.network.message'));
    }
  }

  function resetWizard() {
    setStep('LIST');
    setMutterId('');
    setTochterIds([]);
    setBeteiligungsquote(100);
    setKonsolidierungsArt('VOLLKONSOLIDIERUNG');
    setActiveEinheit(null);
    setVorschauBuchungen([]);
    setSalden(null);
  }

  if (loading) {
    return (
      <div className="text-sm text-slate-500">{t('common.loading')}</div>
    );
  }

  return (
    <div>
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
        </div>
      )}

      {step === 'LIST' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-medium text-slate-900">
              {t('konsolidierung.listTitle')}
            </h2>
            <button
              type="button"
              onClick={() => setStep('MUTTER')}
              className="px-4 py-2 bg-brand-600 text-white rounded-md text-sm font-medium hover:bg-brand-700"
            >
              {t('konsolidierung.actions.new')}
            </button>
          </div>

          {einheiten.length === 0 ? (
            <p className="text-sm text-slate-500">
              {t('konsolidierung.noEinheiten')}
            </p>
          ) : (
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium text-slate-700">
                      {t('konsolidierung.fields.geschaeftsjahr')}
                    </th>
                    <th className="text-left px-4 py-2 font-medium text-slate-700">
                      {t('konsolidierung.fields.mutter')}
                    </th>
                    <th className="text-left px-4 py-2 font-medium text-slate-700">
                      {t('konsolidierung.fields.tochterCount')}
                    </th>
                    <th className="text-left px-4 py-2 font-medium text-slate-700">
                      {t('konsolidierung.fields.status')}
                    </th>
                    <th className="text-right px-4 py-2 font-medium text-slate-700">
                      {t('common.actions')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {einheiten.map((e) => {
                    const mutter = mandanten.find((m) => m.id === e.mutterMandantId);
                    return (
                      <tr key={e.id} className="border-t border-slate-100">
                        <td className="px-4 py-2 text-slate-900">{e.geschaeftsjahr}</td>
                        <td className="px-4 py-2 text-slate-700">
                          {mutter?.firmenname ?? e.mutterMandantId.slice(0, 8)}
                        </td>
                        <td className="px-4 py-2 text-slate-700">
                          {e.tochterMandantIds.length}
                        </td>
                        <td className="px-4 py-2">
                          <StatusBadge status={e.status} />
                        </td>
                        <td className="px-4 py-2 text-right">
                          {e.status === 'DRAFT' && (
                            <button
                              type="button"
                              onClick={async () => {
                                setActiveEinheit(e);
                                setStep('VORSCHAU');
                                await handleCalculate(e.id);
                              }}
                              className="text-brand-700 hover:underline"
                            >
                              {t('konsolidierung.actions.calculate')}
                            </button>
                          )}
                          {e.status === 'COMPLETED' && (
                            <button
                              type="button"
                              onClick={() => handleFinalize(e.id)}
                              className="text-brand-700 hover:underline"
                            >
                              {t('konsolidierung.actions.finalize')}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {(step === 'MUTTER' || step === 'TOCHTER' || step === 'DETAILS') && (
        <div className="bg-white border border-slate-200 rounded-lg p-6">
          <h2 className="text-lg font-medium text-slate-900 mb-4">
            {t('konsolidierung.wizard.title')}
          </h2>

          <div className="flex items-center gap-2 mb-6 text-xs text-slate-600">
            <StepBadge active={step === 'MUTTER'} label={t('konsolidierung.wizard.stepMutter')} />
            <span>›</span>
            <StepBadge active={step === 'TOCHTER'} label={t('konsolidierung.wizard.stepTochter')} />
            <span>›</span>
            <StepBadge active={step === 'DETAILS'} label={t('konsolidierung.wizard.stepDetails')} />
          </div>

          {step === 'MUTTER' && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                {t('konsolidierung.fields.mutter')}
              </label>
              <select
                value={mutterId}
                onChange={(e) => setMutterId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm"
              >
                <option value="">—</option>
                {mandanten.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.firmenname}
                  </option>
                ))}
              </select>
              <div className="flex justify-end gap-2 mt-6">
                <button
                  type="button"
                  onClick={resetWizard}
                  className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => setStep('TOCHTER')}
                  disabled={!mutterId}
                  className="px-4 py-2 bg-brand-600 text-white rounded-md text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
                >
                  {t('common.next')}
                </button>
              </div>
            </div>
          )}

          {step === 'TOCHTER' && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                {t('konsolidierung.fields.tochter')}
              </label>
              <select
                multiple
                value={tochterIds}
                onChange={(e) => {
                  const selected = Array.from(e.target.selectedOptions).map(
                    (o) => o.value,
                  );
                  setTochterIds(selected);
                }}
                className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm h-40"
              >
                {mandanten
                  .filter((m) => m.id !== mutterId)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.firmenname}
                    </option>
                  ))}
              </select>
              <p className="text-xs text-slate-500 mt-2">
                {t('konsolidierung.wizard.tochterHint')}
              </p>
              <div className="flex justify-between mt-6">
                <button
                  type="button"
                  onClick={() => setStep('MUTTER')}
                  className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900"
                >
                  {t('common.back')}
                </button>
                <button
                  type="button"
                  onClick={() => setStep('DETAILS')}
                  disabled={tochterIds.length === 0}
                  className="px-4 py-2 bg-brand-600 text-white rounded-md text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
                >
                  {t('common.next')}
                </button>
              </div>
            </div>
          )}

          {step === 'DETAILS' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  {t('konsolidierung.fields.geschaeftsjahr')}
                </label>
                <input
                  type="number"
                  value={geschaeftsjahr}
                  onChange={(e) =>
                    setGeschaeftsjahr(Number(e.target.value))
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  {t('konsolidierung.fields.beteiligungsquote')}
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={beteiligungsquote}
                  onChange={(e) =>
                    setBeteiligungsquote(Number(e.target.value))
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  {t('konsolidierung.fields.konsolidierungsArt')}
                </label>
                <select
                  value={konsolidierungsArt}
                  onChange={(e) => setKonsolidierungsArt(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm"
                >
                  {KONSOLIDIERUNGS_ARTEN.map((art) => (
                    <option key={art} value={art}>
                      {t(`konsolidierung.konsolidierungsArt.${art}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex justify-between mt-6">
                <button
                  type="button"
                  onClick={() => setStep('TOCHTER')}
                  className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900"
                >
                  {t('common.back')}
                </button>
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={submitting}
                  className="px-4 py-2 bg-brand-600 text-white rounded-md text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
                >
                  {submitting ? t('common.loading') : t('konsolidierung.actions.calculate')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {step === 'VORSCHAU' && activeEinheit && (
        <div className="bg-white border border-slate-200 rounded-lg p-6">
          <h2 className="text-lg font-medium text-slate-900 mb-4">
            {t('konsolidierung.vorschau.title')}
          </h2>

          {vorschauBuchungen.length === 0 ? (
            <p className="text-sm text-slate-500">
              {t('konsolidierung.vorschau.empty')}
            </p>
          ) : (
            <div className="overflow-x-auto mb-6">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-slate-700">
                      {t('konsolidierung.fields.buchungsArt')}
                    </th>
                    <th className="text-left px-3 py-2 font-medium text-slate-700">
                      {t('konsolidierung.fields.beschreibung')}
                    </th>
                    <th className="text-left px-3 py-2 font-medium text-slate-700">
                      {t('konsolidierung.fields.sollHaben')}
                    </th>
                    <th className="text-right px-3 py-2 font-medium text-slate-700">
                      {t('konsolidierung.fields.betrag')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {vorschauBuchungen.map((b) => (
                    <tr key={b.id} className="border-t border-slate-100">
                      <td className="px-3 py-2">
                        {t(`konsolidierung.buchungsArt.${b.buchungsArt}`)}
                      </td>
                      <td className="px-3 py-2 text-slate-700">{b.beschreibung}</td>
                      <td className="px-3 py-2 text-slate-600">
                        {b.kontoSoll} / {b.kontoHaben}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-900">
                        {b.betrag.toFixed(2)} €
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex justify-between">
            <button
              type="button"
              onClick={resetWizard}
              className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900"
            >
              {t('common.back')}
            </button>
            <button
              type="button"
              onClick={() => handleApply(activeEinheit.id)}
              disabled={submitting}
              className="px-4 py-2 bg-brand-600 text-white rounded-md text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
            >
              {submitting
                ? t('common.loading')
                : t('konsolidierung.actions.apply')}
            </button>
          </div>
        </div>
      )}

      {step === 'RESULT' && salden && (
        <div className="bg-white border border-slate-200 rounded-lg p-6">
          <h2 className="text-lg font-medium text-slate-900 mb-4">
            {t('konsolidierung.result.title')}
          </h2>

          <div className="grid grid-cols-2 gap-4 mb-6">
            <SaldenCard
              label={t('konsolidierung.salden.aktiva')}
              value={salden.konzernAktivaSumme}
            />
            <SaldenCard
              label={t('konsolidierung.salden.passiva')}
              value={salden.konzernPassivaSumme}
            />
            <SaldenCard
              label={t('konsolidierung.salden.differenz')}
              value={salden.konzernBilanzDifferenz}
            />
            <SaldenCard
              label={t('konsolidierung.salden.guVErgebnis')}
              value={salden.konzernGuVErgebnis}
            />
            <SaldenCard
              label={t('konsolidierung.salden.eigenkapitalQuote')}
              value={salden.eigenkapitalQuoteKonzern}
              suffix="%"
            />
            <SaldenCard
              label={t('konsolidierung.salden.goodwill')}
              value={salden.goodwill}
            />
            <SaldenCard
              label={t('konsolidierung.salden.badwill')}
              value={salden.badwill}
            />
          </div>

          <div className="flex justify-between">
            <button
              type="button"
              onClick={resetWizard}
              className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900"
            >
              {t('common.back')}
            </button>
            <button
              type="button"
              onClick={() => {
                if (activeEinheit) {
                  void handleFinalize(activeEinheit.id);
                }
                resetWizard();
              }}
              className="px-4 py-2 bg-brand-600 text-white rounded-md text-sm font-medium hover:bg-brand-700"
            >
              {t('konsolidierung.actions.finalize')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    DRAFT: 'bg-slate-100 text-slate-700',
    IN_PROGRESS: 'bg-amber-100 text-amber-700',
    COMPLETED: 'bg-blue-100 text-blue-700',
    VALIDATED: 'bg-green-100 text-green-700',
  };
  return (
    <span
      className={`px-2 py-1 text-xs rounded-full font-medium ${colors[status] ?? 'bg-slate-100 text-slate-700'}`}
    >
      {status}
    </span>
  );
}

function StepBadge({ active, label }: { active: boolean; label: string }) {
  return (
    <span
      className={`px-2 py-1 rounded ${active ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-500'}`}
    >
      {label}
    </span>
  );
}

function SaldenCard({
  label,
  value,
  suffix,
}: {
  label: string;
  value: number;
  suffix?: string;
}) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-md p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-lg font-medium text-slate-900">
        {value.toFixed(2)}
        {suffix ?? ' €'}
      </div>
    </div>
  );
}