'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { apiFetch, getAccessToken } from '@/lib/api';
import { BetragInput } from '@/components/common/BetragInput';

/**
 * Mandanten-Erfassung (M4, Ergänzung nach dem Steuernummer-Befund).
 *
 * Bis hierher gab es im Frontend nur den `MandantSwitcher` — Mandanten waren
 * ausschließlich über die API anlegbar. Für die E-Bilanz braucht es aber
 * Stammdaten, die nur beim Anlegen sinnvoll erfasst werden:
 *   - firmenname, rechtsform
 *   - handelsregister  (HRB-Nr.)   → genInfo.companyInfo.commercialRegister
 *   - steuernummer     (Finanzamt) → genInfo.companyInfo.taxNumber
 *   - ustId
 *   - Adresse
 *   - Geschäftsführung
 *
 * Die Steuernummer ist dabei bewusst als eigenes Feld geführt und NICHT aus
 * der Handelsregisternummer abgeleitet — genau dieser Kurzschluss hat bis
 * 2026-10-01 eine falsche Angabe in das E-Bilanz-Formular geschrieben. Fehlt
 * sie, meldet der Export sie als fehlendes Pflichtfeld (400).
 */

type MandantSummary = {
  id: string;
  firmenname: string;
  rechtsform: string;
  handelsregister: string | null;
  steuernummer: string | null;
  ustId: string | null;
  groessenklasse: string;
  /**
   * BEFUND 2026-10-09: Das Feld stand im API-Response, war hier aber nicht
   * typisiert und wurde nirgends angezeigt. Der Archivzustand war damit
   * für die Oberfläche unsichtbar — der Anwender konnte nicht erkennen,
   * dass ein Mandant nicht mehr fortgeschrieben wird.
   */
  archiviertAt?: string | null;
};

type MandantListResponse = MandantSummary[] | { items: MandantSummary[] };

type FormState = {
  firmenname: string;
  rechtsform: string;
  handelsregister: string;
  steuernummer: string;
  ustId: string;
  strasse: string;
  plz: string;
  ort: string;
  land: string;
  geschaeftsfuehrer: Array<{ name: string; geburtsdatum: string; anteilProzent: number }>;
  groessenklasse: string;
  publishChannel: string;
  gruendungsdatum: string;
};

const RECHTSFORMEN = ['GmbH', 'GmbH & Co. KG', 'AG', 'GmbH i. L.', 'UG (haftungsbeschränkt)', 'SE'];

/**
 * Veröffentlichungskanal — Pflichtfeld im Backend-DTO (`@IsEnum(PUBLISH_CHANNELS)`).
 * Bestimmt, in welchem Format der Jahresabschluss veröffentlicht wird.
 */
const PUBLISH_CHANNELS: Array<{ value: string; label: string }> = [
  { value: 'EBILANZ_TAXONOMIE', label: 'E-Bilanz-Taxonomie (§ 5b EStG, ELSTER)' },
  { value: 'XML_XBRL', label: 'XML/XBRL (Bundesanzeiger)' },
  { value: 'PDF_DIRECT', label: 'PDF (direkte Veröffentlichung)' },
];

const GROESSENKLASSEN: Array<{ value: string; label: string }> = [
  { value: 'KLEINST', label: 'Kleinstunternehmen (§ 267 Abs. 1 HGB)' },
  { value: 'KLEIN', label: 'Kleines Unternehmen (§ 267 Abs. 2 HGB)' },
  { value: 'MITTEL', label: 'Mittelständisch (§ 267 Abs. 3 HGB)' },
  { value: 'GROSS', label: 'Großunternehmen (§ 267 Abs. 4 HGB)' },
];

const EMPTY_FORM: FormState = {
  firmenname: '',
  rechtsform: 'GmbH',
  handelsregister: '',
  steuernummer: '',
  ustId: '',
  strasse: '',
  plz: '',
  ort: '',
  land: 'DE',
  geschaeftsfuehrer: [{ name: '', geburtsdatum: '', anteilProzent: 100 }],
  groessenklasse: 'KLEINST',
  publishChannel: 'EBILANZ_TAXONOMIE',
  gruendungsdatum: '',
};

export function MandantForm() {
  const t = useTranslations();
  const router = useRouter();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [mandanten, setMandanten] = useState<MandantSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const token = getAccessToken();
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await apiFetch<MandantListResponse>('/mandant', { accessToken: token });
      setMandanten(Array.isArray(data) ? data : (data.items ?? []));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function setGf(
    index: number,
    key: keyof FormState['geschaeftsfuehrer'][number],
    value: string | number,
  ): void {
    setForm((prev) => {
      const next = [...prev.geschaeftsfuehrer];
      const entry = { ...next[index] };
      if (key === 'anteilProzent') {
        // Zahlen kommen seit 2026-10-15 aus `BetragInput` und sind bereits
        // aufgeloest. Der String-Zweig bleibt fuer Aufrufer, die rohen Text
        // liefern — und darf hier NICHT mehr `parseFloat` sein: das macht
        // aus "33,33" die 33.
        entry.anteilProzent =
          typeof value === 'number' ? value : (Number.parseFloat(value) || 0);
      } else {
        // Die uebrigen Felder (name, geburtsdatum) sind Text.
        entry[key] = String(value);
      }
      next[index] = entry;
      return { ...prev, geschaeftsfuehrer: next };
    });
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      const token = getAccessToken();
      const payload = {
        firmenname: form.firmenname.trim(),
        rechtsform: form.rechtsform,
        ...(form.handelsregister.trim() ? { handelsregister: form.handelsregister.trim() } : {}),
        ...(form.steuernummer.trim() ? { steuernummer: form.steuernummer.trim() } : {}),
        ...(form.ustId.trim() ? { ustId: form.ustId.trim() } : {}),
        adresse: {
          strasse: form.strasse.trim(),
          plz: form.plz.trim(),
          ort: form.ort.trim(),
          land: form.land.trim().toUpperCase(),
        },
        geschaeftsfuehrer: form.geschaeftsfuehrer
          .filter((g) => g.name.trim().length > 0)
          .map((g) => ({
            name: g.name.trim(),
            geburtsdatum: g.geburtsdatum || '1970-01-01',
            anteilProzent: g.anteilProzent,
          })),
        groessenklasse: form.groessenklasse,
        publishChannel: form.publishChannel,
        ...(form.gruendungsdatum ? { gruendungsdatum: form.gruendungsdatum } : {}),
      };
      await apiFetch<MandantSummary>('/mandant', {
        method: 'POST',
        accessToken: token ?? undefined,
        body: JSON.stringify(payload),
      });
      setNotice(t('mandant.createSuccess'));
      setForm(EMPTY_FORM);
      await load();
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string, name: string): Promise<void> {
    if (!window.confirm(t('mandant.confirmDelete', { name }))) return;
    setError(null);
    try {
      const token = getAccessToken();
      await apiFetch<void>(`/mandant/${id}`, {
        method: 'DELETE',
        accessToken: token ?? undefined,
      });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  /**
   * Archivieren / Archiv aufheben.
   *
   * Ersetzt NICHT das Löschen: der Bestand eines Mandanten mit
   * Buchhaltungsdaten darf nach § 147 AO nicht vernichtet werden. Archiv
   * heißt — keine neuen Belege mehr, Bestand bleibt lesbar.
   */
  async function handleArchivieren(
    id: string,
    name: string,
    archiviert: boolean,
  ): Promise<void> {
    const frage = archiviert
      ? t('mandant.confirmUnarchive', { name })
      : t('mandant.confirmArchive', { name });
    if (!window.confirm(frage)) return;
    setError(null);
    try {
      const token = getAccessToken();
      await apiFetch(`/mandant/${id}/archivierung${archiviert ? '/aufheben' : ''}`, {
        method: 'PATCH',
        accessToken: token ?? undefined,
      });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const inputCls =
    'mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500';
  const labelCls = 'block text-sm font-medium text-slate-700';

  if (loading) {
    return <p className="text-sm text-slate-600">{t('common.loading')}</p>;
  }

  return (
    <div className="space-y-8">
      {/* Bestehende Mandanten */}
      <section>
        <h2 className="text-lg font-semibold text-slate-900">
          {t('mandant.existingTitle')}
        </h2>
        {mandanten.length === 0 ? (
          <p className="mt-2 rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
            {t('mandant.noneYet')}
          </p>
        ) : (
          <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-slate-700">
                      {t('mandant.table.company')}
                    </th>
                    <th className="px-4 py-2 text-left font-medium text-slate-700">
                      {t('mandant.table.handelsregister')}
                    </th>
                    <th className="px-4 py-2 text-left font-medium text-slate-700">
                      {t('mandant.table.steuernummer')}
                    </th>
                    <th className="px-4 py-2 text-left font-medium text-slate-700">
                      {t('mandant.table.size')}
                    </th>
                    <th className="px-4 py-2 text-right font-medium text-slate-700">
                      {t('common.actions')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {mandanten.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2">
                        <div className="font-medium text-slate-900">{m.firmenname}</div>
                        <div className="text-xs text-slate-500">{m.rechtsform}</div>
                      </td>
                      <td className="px-4 py-2 text-slate-700">
                        {m.handelsregister ?? '—'}
                      </td>
                      <td className="px-4 py-2">
                        {m.steuernummer ? (
                          <span className="text-slate-900">{m.steuernummer}</span>
                        ) : (
                          <span
                            className="inline-flex rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
                            title={t('mandant.steuernummerMissingHint')}
                          >
                            {t('mandant.steuernummerMissing')}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-slate-700">{m.groessenklasse}</td>
                      <td className="px-4 py-2 text-right">
                        {/* Ein archivierter Mandant wird gekennzeichnet: er
                            ist nicht fortgeschreibbar. Ohne diese Spur
                            wäre nicht erkennbar, warum eine Eingabe
                            mit 409 abgelehnt wird. */}
                        {m.archiviertAt ? (
                          <span
                            className="mr-3 inline-flex items-center rounded bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700"
                            title={t('mandant.archivedHint', {
                              date: new Date(m.archiviertAt).toLocaleString('de-DE'),
                            })}
                          >
                            {t('mandant.archived')}
                          </span>
                        ) : null}
                        <div className="inline-flex gap-3">
                          <button
                            type="button"
                            onClick={() =>
                              void handleArchivieren(
                                m.id,
                                m.firmenname,
                                Boolean(m.archiviertAt),
                              )
                            }
                            className="text-sm text-slate-600 hover:text-slate-900"
                          >
                            {m.archiviertAt
                              ? t('mandant.unarchive')
                              : t('mandant.archive')}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDelete(m.id, m.firmenname)}
                            className="text-sm text-red-600 hover:text-red-800"
                            title={t('mandant.deleteHint')}
                          >
                            {t('common.delete')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* Neuen Mandanten anlegen */}
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">
          {t('mandant.createTitle')}
        </h2>
        <p className="mt-1 text-sm text-slate-600">{t('mandant.createSubtitle')}</p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-5" noValidate>
          {/* Firmen-Daten */}
          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold text-slate-800">
              {t('mandant.section.company')}
            </legend>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="firmenname" className={labelCls}>
                  {t('mandant.field.firmenname')}
                </label>
                <input
                  id="firmenname"
                  required
                  minLength={2}
                  value={form.firmenname}
                  onChange={(e) => set('firmenname', e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label htmlFor="rechtsform" className={labelCls}>
                  {t('mandant.field.rechtsform')}
                </label>
                <select
                  id="rechtsform"
                  value={form.rechtsform}
                  onChange={(e) => set('rechtsform', e.target.value)}
                  className={inputCls}
                >
                  {RECHTSFORMEN.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="handelsregister" className={labelCls}>
                  {t('mandant.field.handelsregister')}
                </label>
                <input
                  id="handelsregister"
                  value={form.handelsregister}
                  onChange={(e) => set('handelsregister', e.target.value)}
                  placeholder="HRB 123456"
                  className={inputCls}
                />
              </div>
              <div>
                <label htmlFor="steuernummer" className={labelCls}>
                  {t('mandant.field.steuernummer')}
                </label>
                <input
                  id="steuernummer"
                  value={form.steuernummer}
                  onChange={(e) => set('steuernummer', e.target.value)}
                  placeholder="12/345/67890"
                  className={inputCls}
                />
                <p className="mt-1 text-xs text-slate-500">
                  {t('mandant.field.steuernummerHint')}
                </p>
              </div>
              <div>
                <label htmlFor="ustId" className={labelCls}>
                  {t('mandant.field.ustId')}
                </label>
                <input
                  id="ustId"
                  value={form.ustId}
                  onChange={(e) => set('ustId', e.target.value)}
                  placeholder="DE123456789"
                  className={inputCls}
                />
              </div>
              <div>
                <label htmlFor="groessenklasse" className={labelCls}>
                  {t('mandant.field.groessenklasse')}
                </label>
                <select
                  id="groessenklasse"
                  value={form.groessenklasse}
                  onChange={(e) => set('groessenklasse', e.target.value)}
                  className={inputCls}
                >
                  {GROESSENKLASSEN.map((g) => (
                    <option key={g.value} value={g.value}>
                      {g.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="publishChannel" className={labelCls}>
                  {t('mandant.field.publishChannel')}
                </label>
                <select
                  id="publishChannel"
                  value={form.publishChannel}
                  onChange={(e) => set('publishChannel', e.target.value)}
                  className={inputCls}
                >
                  {PUBLISH_CHANNELS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-slate-500">
                  {t('mandant.field.publishChannelHint')}
                </p>
              </div>
            </div>
          </fieldset>

          {/* Adresse */}
          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold text-slate-800">
              {t('mandant.section.address')}
            </legend>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label htmlFor="strasse" className={labelCls}>
                  {t('mandant.field.strasse')}
                </label>
                <input
                  id="strasse"
                  required
                  value={form.strasse}
                  onChange={(e) => set('strasse', e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label htmlFor="plz" className={labelCls}>
                  {t('mandant.field.plz')}
                </label>
                <input
                  id="plz"
                  required
                  value={form.plz}
                  onChange={(e) => set('plz', e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label htmlFor="ort" className={labelCls}>
                  {t('mandant.field.ort')}
                </label>
                <input
                  id="ort"
                  required
                  value={form.ort}
                  onChange={(e) => set('ort', e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label htmlFor="land" className={labelCls}>
                  {t('mandant.field.land')}
                </label>
                <input
                  id="land"
                  required
                  maxLength={2}
                  value={form.land}
                  onChange={(e) => set('land', e.target.value)}
                  className={inputCls}
                />
              </div>
            </div>
          </fieldset>

          {/* Geschäftsführung */}
          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold text-slate-800">
              {t('mandant.section.managers')}
            </legend>
            {form.geschaeftsfuehrer.map((g, i) => (
              <div key={i} className="grid grid-cols-1 gap-4 sm:grid-cols-4">
                <div className="sm:col-span-2">
                  <label htmlFor={`gf-name-${i}`} className={labelCls}>
                    {t('mandant.field.managerName')}
                  </label>
                  <input
                    id={`gf-name-${i}`}
                    required={i === 0}
                    value={g.name}
                    onChange={(e) => setGf(i, 'name', e.target.value)}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label htmlFor={`gf-birth-${i}`} className={labelCls}>
                    {t('mandant.field.managerBirth')}
                  </label>
                  <input
                    id={`gf-birth-${i}`}
                    type="date"
                    value={g.geburtsdatum}
                    onChange={(e) => setGf(i, 'geburtsdatum', e.target.value)}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label htmlFor={`gf-share-${i}`} className={labelCls}>
                    {t('mandant.field.managerShare')}
                  </label>
                  {/* „33,33" statt „33.33" — dieselbe deutsche
                      Schreibweise wie in den Betragsfeldern. */}
                  <BetragInput
                    ariaLabel={t('mandant.field.managerShare')}
                    wert={g.anteilProzent}
                    onWert={(v) => setGf(i, 'anteilProzent', v ?? 0)}
                  />
                </div>
              </div>
            ))}
            {form.geschaeftsfuehrer.length < 3 && (
              <button
                type="button"
                onClick={() =>
                  setForm((prev) => ({
                    ...prev,
                    geschaeftsfuehrer: [
                      ...prev.geschaeftsfuehrer,
                      { name: '', geburtsdatum: '', anteilProzent: 0 },
                    ],
                  }))
                }
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                {t('mandant.addManager')}
              </button>
            )}
          </fieldset>

          {notice && (
            <div className="rounded-md border border-green-200 bg-green-50 p-3">
              <p className="text-sm text-green-800">{notice}</p>
            </div>
          )}
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-brand-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? t('mandant.saving') : t('mandant.create')}
          </button>
        </form>
      </section>
    </div>
  );
}
