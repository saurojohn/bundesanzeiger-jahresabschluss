'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiFetch, getAccessToken, getActiveMandantId } from '@/lib/api';

type SessionUser = {
  id: string;
  email: string;
  vorname: string;
  nachname: string;
  globalRole: 'USER' | 'SYSTEM_ADMIN';
  mandanten: Array<{
    id: string;
    firmenname: string;
    rolle: 'GF' | 'STEUERBERATER' | 'WIRTSCHAFTSPRUEFER' | 'KANZLEI_ADMIN';
  }>;
};

type Mandant = { id: string; firmenname: string };

type BilanzSummary = {
  id: string;
  mandantId: string;
  geschaeftsjahr: number;
  status: string;
};

type BilanzPruefungsResult = {
  regelCode: string;
  status: 'PASSED' | 'WARNUNG' | 'KRITISCH';
  berechneterWert: number;
  schwellwert: number;
  meldung: string;
  geprueftAm: string;
};

type WPNotiz = {
  id: string;
  bilanzId: string | null;
  guvId: string | null;
  bilanzPositionId: string | null;
  guvPositionId: string | null;
  wpUserId: string;
  notizText: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'NEEDS_REVISION';
  createdAt: string;
  updatedAt: string;
  acknowledgedAt: string | null;
  acknowledgedById: string | null;
};

type WPPruefung = {
  id: string;
  bilanzId: string;
  guvId: string | null;
  wpUserId: string;
  status: 'IN_PROGRESS' | 'APPROVED' | 'REJECTED';
  zusammenfassung: string | null;
  startedAt: string;
  completedAt: string | null;
  pruefungsResults: BilanzPruefungsResult[];
  notizen: WPNotiz[];
};

type WPReport = { pruefungId: string; markdownReport: string };

const IDW_REGEL_CODES = [
  'IDW_EK_QUOTE',
  'IDW_LIQUIDITAET_1',
  'IDW_VERSCHULDUNGSGRAD',
  'IDW_ANLAGEVERMOEGEN_BIS_AKTIVA',
  'IDW_GOING_CONCERN',
] as const;

type ViewMode = 'DASHBOARD' | 'PRUEFUNG';

export function WPView() {
  const t = useTranslations();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('DASHBOARD');

  const [mandanten, setMandanten] = useState<Mandant[]>([]);
  const [bilanzen, setBilanzen] = useState<BilanzSummary[]>([]);
  const [activeMandantId, setActiveMandantId] = useState<string | null>(null);
  const [activeBilanzId, setActiveBilanzId] = useState<string | null>(null);

  const [pruefung, setPruefung] = useState<WPPruefung | null>(null);
  const [report, setReport] = useState<WPReport | null>(null);
  const [showReport, setShowReport] = useState(false);

  const [newNotizText, setNewNotizText] = useState('');
  const [notizError, setNotizError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [finalZusammenfassung, setFinalZusammenfassung] = useState('');
  const [finalStatus, setFinalStatus] = useState<'APPROVED' | 'REJECTED'>('APPROVED');
  const [showFinalize, setShowFinalize] = useState(false);

  const isWP = useMemo(() => {
    if (!user) return false;
    return (
      user.globalRole === 'SYSTEM_ADMIN' ||
      user.mandanten.some((m) => m.rolle === 'WIRTSCHAFTSPRUEFER')
    );
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const token = getAccessToken();
      if (!token) return;
      const meRes = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!meRes.ok) return;
      const me = (await meRes.json()) as SessionUser;
      if (cancelled) return;
      setUser(me);
      // Bugfix 2026-10-04: hier stand '/mandanten' (Plural). Der Endpoint
      // heißt '/mandant' — der 404 threw, `setLoading(false)` wurde nie
      // erreicht und die komplette Fachseite blieb auf "Wird geladen …"
      // hängen, mit leerem Mandanten-Picker. Gefunden durch einen Audit
      // aller 12 Fachseiten mit echten Daten.
      const mandantRes = await apiFetch<Mandant[]>('/mandant', { accessToken: token });
      setMandanten(mandantRes);
      const initMandant = getActiveMandantId() ?? me.mandanten[0]?.id ?? mandantRes[0]?.id ?? null;
      setActiveMandantId(initMandant);
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadBilanzen() {
      if (!activeMandantId) {
        setBilanzen([]);
        return;
      }
      const token = getAccessToken();
      if (!token) return;
      const list = await apiFetch<BilanzSummary[]>(
        `/bilanz?mandantId=${activeMandantId}`,
        { accessToken: token },
      );
      if (!cancelled) setBilanzen(list);
    }
    void loadBilanzen();
    return () => {
      cancelled = true;
    };
  }, [activeMandantId]);

  useEffect(() => {
    let cancelled = false;
    async function loadPruefung() {
      if (!activeBilanzId) {
        setPruefung(null);
        return;
      }
      const token = getAccessToken();
      if (!token) return;
      try {
        const list = await apiFetch<Array<{ id: string }>>(
          `/wp/bilanz/${activeBilanzId}/pruefungen`,
          { accessToken: token },
        );
        if (list.length === 0) {
          if (!cancelled) setPruefung(null);
          return;
        }
        const detail = await apiFetch<WPPruefung>(
          `/wp/pruefungen/${list[0]!.id}`,
          { accessToken: token },
        );
        if (!cancelled) setPruefung(detail);
      } catch {
        if (!cancelled) setPruefung(null);
      }
    }
    void loadPruefung();
    return () => {
      cancelled = true;
    };
  }, [activeBilanzId]);

  async function runPlausi() {
    if (!activeBilanzId) return;
    const token = getAccessToken();
    if (!token) return;
    setSubmitting(true);
    try {
      await apiFetch(`/wp/bilanz/${activeBilanzId}/regeln/run`, {
        method: 'POST',
        body: JSON.stringify({}),
        accessToken: token,
      });
      // Reload pruefung
      const list = await apiFetch<Array<{ id: string }>>(
        `/wp/bilanz/${activeBilanzId}/pruefungen`,
        { accessToken: token },
      );
      if (list.length > 0) {
        const detail = await apiFetch<WPPruefung>(
          `/wp/pruefungen/${list[0]!.id}`,
          { accessToken: token },
        );
        setPruefung(detail);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function startPruefung() {
    if (!activeBilanzId) return;
    const token = getAccessToken();
    if (!token) return;
    setSubmitting(true);
    setNotizError(null);
    try {
      const created = await apiFetch<WPPruefung>('/wp/pruefungen', {
        method: 'POST',
        body: JSON.stringify({ bilanzId: activeBilanzId }),
        accessToken: token,
      });
      setPruefung(created);
    } catch (err) {
      setNotizError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function createNotiz() {
    if (!activeBilanzId || !newNotizText.trim()) return;
    const token = getAccessToken();
    if (!token) return;
    setSubmitting(true);
    setNotizError(null);
    try {
      await apiFetch('/wp/notizen', {
        method: 'POST',
        body: JSON.stringify({ bilanzId: activeBilanzId, notizText: newNotizText }),
        accessToken: token,
      });
      setNewNotizText('');
      await refreshPruefung();
    } catch (err) {
      setNotizError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function updateNotizStatus(
    notizId: string,
    status: 'APPROVED' | 'REJECTED' | 'NEEDS_REVISION',
  ) {
    const token = getAccessToken();
    if (!token) return;
    setSubmitting(true);
    setNotizError(null);
    try {
      await apiFetch(`/wp/notizen/${notizId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
        accessToken: token,
      });
      await refreshPruefung();
    } catch (err) {
      setNotizError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function finalizePruefung() {
    if (!pruefung || !finalZusammenfassung.trim()) return;
    const token = getAccessToken();
    if (!token) return;
    setSubmitting(true);
    setNotizError(null);
    try {
      const updated = await apiFetch<WPPruefung>(
        `/wp/pruefungen/${pruefung.id}/finalize`,
        {
          method: 'POST',
          body: JSON.stringify({
            status: finalStatus,
            zusammenfassung: finalZusammenfassung,
          }),
          accessToken: token,
        },
      );
      setPruefung(updated);
      setShowFinalize(false);
      setFinalZusammenfassung('');
    } catch (err) {
      setNotizError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function loadReport() {
    if (!pruefung) return;
    const token = getAccessToken();
    if (!token) return;
    setSubmitting(true);
    try {
      const r = await apiFetch<WPReport>(
        `/wp/pruefungen/${pruefung.id}/report`,
        { accessToken: token },
      );
      setReport(r);
      setShowReport(true);
    } catch (err) {
      setNotizError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function refreshPruefung() {
    if (!activeBilanzId) return;
    const token = getAccessToken();
    if (!token) return;
    try {
      const list = await apiFetch<Array<{ id: string }>>(
        `/wp/bilanz/${activeBilanzId}/pruefungen`,
        { accessToken: token },
      );
      if (list.length === 0) {
        setPruefung(null);
        return;
      }
      const detail = await apiFetch<WPPruefung>(
        `/wp/pruefungen/${list[0]!.id}`,
        { accessToken: token },
      );
      setPruefung(detail);
    } catch {
      // ignore
    }
  }

  if (loading) {
    return <div className="text-sm text-slate-500">{t('common.loading')}</div>;
  }

  if (!activeMandantId) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        {t('wp.noMandant')}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <MandantPicker
        mandanten={mandanten}
        activeMandantId={activeMandantId}
        bilanzen={bilanzen}
        onChangeMandant={(id) => {
          setActiveMandantId(id);
          setActiveBilanzId(null);
          setPruefung(null);
          setViewMode('DASHBOARD');
        }}
        onChangeBilanz={(id) => {
          setActiveBilanzId(id);
          setViewMode('PRUEFUNG');
        }}
        activeBilanzId={activeBilanzId}
      />

      {viewMode === 'DASHBOARD' && (
        <PlausiDashboard
          mandanten={mandanten}
          bilanzen={bilanzen}
          activeMandantId={activeMandantId}
          onOpen={(bilanzId) => {
            setActiveBilanzId(bilanzId);
            setViewMode('PRUEFUNG');
          }}
        />
      )}

      {viewMode === 'PRUEFUNG' && activeBilanzId && (
        <PruefungDetail
          pruefung={pruefung}
          isWP={isWP}
          userId={user?.id ?? ''}
          notizError={notizError}
          newNotizText={newNotizText}
          setNewNotizText={setNewNotizText}
          onCreateNotiz={createNotiz}
          onUpdateNotizStatus={updateNotizStatus}
          onStartPruefung={startPruefung}
          onRunPlausi={runPlausi}
          onLoadReport={loadReport}
          submitting={submitting}
          showFinalize={showFinalize}
          setShowFinalize={setShowFinalize}
          finalZusammenfassung={finalZusammenfassung}
          setFinalZusammenfassung={setFinalZusammenfassung}
          finalStatus={finalStatus}
          setFinalStatus={setFinalStatus}
          onFinalize={finalizePruefung}
        />
      )}

      {showReport && report && (
        <ReportModal report={report} onClose={() => setShowReport(false)} />
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Sub-Components
// ----------------------------------------------------------------------------

function MandantPicker(props: {
  mandanten: Mandant[];
  bilanzen: BilanzSummary[];
  activeMandantId: string;
  activeBilanzId: string | null;
  onChangeMandant: (id: string) => void;
  onChangeBilanz: (id: string) => void;
}) {
  const t = useTranslations();
  return (
    <div className="flex flex-wrap items-end gap-4 rounded-md border border-slate-200 bg-white p-4">
      <div>
        <label className="block text-xs font-medium text-slate-700">
          Mandant
        </label>
        <select
          value={props.activeMandantId}
          onChange={(e) => props.onChangeMandant(e.target.value)}
          className="mt-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          {props.mandanten.map((m) => (
            <option key={m.id} value={m.id}>
              {m.firmenname}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-700">
          Geschäftsjahr
        </label>
        <select
          value={props.activeBilanzId ?? ''}
          onChange={(e) => props.onChangeBilanz(e.target.value)}
          className="mt-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">— auswählen —</option>
          {props.bilanzen.map((b) => (
            <option key={b.id} value={b.id}>
              {b.geschaeftsjahr} ({b.status})
            </option>
          ))}
        </select>
      </div>
      <div className="ml-auto text-xs text-slate-500">
        {t('wp.subtitle')}
      </div>
    </div>
  );
}

function PlausiDashboard(props: {
  mandanten: Mandant[];
  bilanzen: BilanzSummary[];
  activeMandantId: string;
  onOpen: (bilanzId: string) => void;
}) {
  const t = useTranslations();
  const mandantById = useMemo(() => {
    const map = new Map<string, Mandant>();
    for (const m of props.mandanten) map.set(m.id, m);
    return map;
  }, [props.mandanten]);

  if (props.bilanzen.length === 0) {
    return (
      <div className="rounded-md border border-slate-200 bg-white p-6 text-sm text-slate-500">
        {t('wp.dashboard.noMandanten')}
      </div>
    );
  }

  return (
    <div className="rounded-md border border-slate-200 bg-white">
      <div className="border-b border-slate-200 p-4">
        <h2 className="text-lg font-semibold text-slate-900">
          {t('wp.dashboard.title')}
        </h2>
        <p className="text-sm text-slate-600">{t('wp.dashboard.subtitle')}</p>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <th className="p-3">{t('wp.dashboard.tableMandant')}</th>
            <th className="p-3">{t('wp.dashboard.tableGeschaeftsjahr')}</th>
            <th className="p-3">{t('wp.dashboard.tableStatus')}</th>
            <th className="p-3 text-right">{t('wp.dashboard.tableAktion')}</th>
          </tr>
        </thead>
        <tbody>
          {props.bilanzen.map((b) => (
            <tr key={b.id} className="border-t border-slate-100">
              <td className="p-3 text-slate-900">
                {mandantById.get(b.mandantId)?.firmenname ?? b.mandantId}
              </td>
              <td className="p-3 text-slate-900">{b.geschaeftsjahr}</td>
              <td className="p-3">
                <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                  {t(`wp.status.${b.status}`)}
                </span>
              </td>
              <td className="p-3 text-right">
                <button
                  type="button"
                  className="rounded-md bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700"
                  onClick={() => props.onOpen(b.id)}
                >
                  {t('wp.dashboard.openPruefung')}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PruefungDetail(props: {
  pruefung: WPPruefung | null;
  isWP: boolean;
  userId: string;
  notizError: string | null;
  newNotizText: string;
  setNewNotizText: (s: string) => void;
  onCreateNotiz: () => void;
  onUpdateNotizStatus: (
    id: string,
    status: 'APPROVED' | 'REJECTED' | 'NEEDS_REVISION',
  ) => void;
  onStartPruefung: () => void;
  onRunPlausi: () => void;
  onLoadReport: () => void;
  submitting: boolean;
  showFinalize: boolean;
  setShowFinalize: (b: boolean) => void;
  finalZusammenfassung: string;
  setFinalZusammenfassung: (s: string) => void;
  finalStatus: 'APPROVED' | 'REJECTED';
  setFinalStatus: (s: 'APPROVED' | 'REJECTED') => void;
  onFinalize: () => void;
}) {
  const t = useTranslations();

  if (!props.pruefung) {
    return (
      <div className="rounded-md border border-slate-200 bg-white p-6">
        <p className="text-sm text-slate-600">
          {t('wp.pruefung.noResults')}
        </p>
        {props.isWP && (
          <button
            type="button"
            disabled={props.submitting}
            onClick={props.onStartPruefung}
            className="mt-4 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {t('wp.actions.startPruefung')}
          </button>
        )}
      </div>
    );
  }

  const passed = props.pruefung.pruefungsResults.filter(
    (r) => r.status === 'PASSED',
  ).length;
  const warnung = props.pruefung.pruefungsResults.filter(
    (r) => r.status === 'WARNUNG',
  ).length;
  const kritisch = props.pruefung.pruefungsResults.filter(
    (r) => r.status === 'KRITISCH',
  ).length;

  const isFinalized = props.pruefung.status !== 'IN_PROGRESS';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between rounded-md border border-slate-200 bg-white p-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            {t('wp.pruefung.title')} ({props.pruefung.id.slice(0, 8)})
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {t('wp.status.' + props.pruefung.status)} ·{' '}
            {new Date(props.pruefung.startedAt).toLocaleString('de-DE')}
          </p>
        </div>
        <StatusAmpel passed={passed} warnung={warnung} kritisch={kritisch} />
      </div>

      {props.notizError && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {props.notizError}
        </div>
      )}

      {/* Plausi-Ergebnisse */}
      <div className="rounded-md border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 p-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              {t('wp.pruefung.resultsTitle')}
            </h3>
            <p className="text-xs text-slate-500">
              {t('wp.pruefung.resultsAnzahl', {
                anzahl: props.pruefung.pruefungsResults.length,
              })}
            </p>
          </div>
          {props.isWP && !isFinalized && (
            <button
              type="button"
              disabled={props.submitting}
              onClick={props.onRunPlausi}
              className="rounded-md bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200 disabled:opacity-50"
            >
              {t('wp.actions.runPlausi')}
            </button>
          )}
        </div>
        {props.pruefung.pruefungsResults.length === 0 ? (
          <div className="p-4 text-sm text-slate-500">
            {t('wp.pruefung.noResults')}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <th className="p-3">Regel</th>
                <th className="p-3">Status</th>
                <th className="p-3 text-right">Berechnet</th>
                <th className="p-3 text-right">Schwellwert</th>
                <th className="p-3">Meldung</th>
              </tr>
            </thead>
            <tbody>
              {props.pruefung.pruefungsResults.map((r) => (
                <tr key={r.regelCode} className="border-t border-slate-100">
                  <td className="p-3 text-slate-900">
                    <div className="font-medium">{r.regelCode}</div>
                    <div className="text-xs text-slate-500">
                      {t(`wp.regel.${r.regelCode}.name`)}
                    </div>
                  </td>
                  <td className="p-3">
                    <span
                      className={
                        'rounded-full px-2 py-1 text-xs font-medium ' +
                        statusBadgeClass(r.status)
                      }
                    >
                      {t(`wp.status.${r.status}`)}
                    </span>
                  </td>
                  <td className="p-3 text-right font-mono text-xs">
                    {r.berechneterWert.toFixed(2)}
                  </td>
                  <td className="p-3 text-right font-mono text-xs">
                    {r.schwellwert.toFixed(2)}
                  </td>
                  <td className="p-3 text-xs text-slate-600">{r.meldung}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* WP-Notizen */}
      <div className="rounded-md border border-slate-200 bg-white">
        <div className="border-b border-slate-200 p-4">
          <h3 className="text-base font-semibold text-slate-900">
            {t('wp.notiz.title')}
          </h3>
        </div>
        <div className="space-y-3 p-4">
          {props.pruefung.notizen.length === 0 ? (
            <p className="text-sm text-slate-500">
              {t('wp.notiz.emptyText')}
            </p>
          ) : (
            props.pruefung.notizen.map((n) => (
              <NotizCard
                key={n.id}
                notiz={n}
                isSelf={n.wpUserId === props.userId}
                isFinalized={isFinalized}
                onAck={(status) => props.onUpdateNotizStatus(n.id, status)}
              />
            ))
          )}

          {props.isWP && !isFinalized && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <label className="block text-xs font-medium text-slate-700">
                {t('wp.notiz.newTitle')}
              </label>
              <textarea
                value={props.newNotizText}
                onChange={(e) => props.setNewNotizText(e.target.value)}
                placeholder={t('wp.notiz.placeholder')}
                maxLength={500}
                rows={3}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <div className="mt-2 flex justify-end gap-2">
                <button
                  type="button"
                  disabled={props.submitting || !props.newNotizText.trim()}
                  onClick={props.onCreateNotiz}
                  className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                >
                  {t('wp.actions.addNotiz')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Aktionen */}
      <div className="flex flex-wrap gap-2 rounded-md border border-slate-200 bg-white p-4">
        <button
          type="button"
          onClick={props.onLoadReport}
          disabled={props.submitting}
          className="rounded-md bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200 disabled:opacity-50"
        >
          {t('wp.actions.showReport')}
        </button>
        {props.isWP && !isFinalized && (
          <button
            type="button"
            onClick={() => props.setShowFinalize(true)}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            {t('wp.actions.finalize')}
          </button>
        )}
      </div>

      {/* Finalize-Dialog */}
      {props.showFinalize && (
        <div className="rounded-md border border-slate-200 bg-white p-4">
          <h3 className="text-base font-semibold text-slate-900">
            {t('wp.pruefung.finalizeTitle')}
          </h3>
          <label className="mt-3 block text-xs font-medium text-slate-700">
            {t('wp.pruefung.finalStatus')}
          </label>
          <select
            value={props.finalStatus}
            onChange={(e) =>
              props.setFinalStatus(e.target.value as 'APPROVED' | 'REJECTED')
            }
            className="mt-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="APPROVED">{t('wp.status.APPROVED')}</option>
            <option value="REJECTED">{t('wp.status.REJECTED')}</option>
          </select>
          <label className="mt-3 block text-xs font-medium text-slate-700">
            {t('wp.pruefung.zusammenfassung')}
          </label>
          <textarea
            value={props.finalZusammenfassung}
            onChange={(e) => props.setFinalZusammenfassung(e.target.value)}
            placeholder={t('wp.pruefung.finalizePlaceholder')}
            rows={3}
            maxLength={2000}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => props.setShowFinalize(false)}
              className="rounded-md bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200"
            >
              {t('wp.actions.cancel')}
            </button>
            <button
              type="button"
              disabled={props.submitting || !props.finalZusammenfassung.trim()}
              onClick={props.onFinalize}
              className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {t('wp.actions.finalize')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function NotizCard(props: {
  notiz: WPNotiz;
  isSelf: boolean;
  isFinalized: boolean;
  onAck: (status: 'APPROVED' | 'REJECTED' | 'NEEDS_REVISION') => void;
}) {
  const t = useTranslations();
  const isAcknowledged = props.notiz.status !== 'PENDING';
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <div className="text-xs text-slate-500">
            {new Date(props.notiz.createdAt).toLocaleString('de-DE')} ·{' '}
            <span
              className={
                'rounded-full px-2 py-0.5 text-xs font-medium ' +
                statusBadgeClass(notizStatusToRegelStatus(props.notiz.status))
              }
            >
              {t(`wp.status.${props.notiz.status}`)}
            </span>
          </div>
          <p className="mt-2 text-sm text-slate-900">{props.notiz.notizText}</p>
          {props.notiz.acknowledgedAt && (
            <p className="mt-1 text-xs text-slate-500">
              {t('wp.notiz.acknowledgedBy')}{' '}
              {props.notiz.acknowledgedById?.slice(0, 8)} ·{' '}
              {new Date(props.notiz.acknowledgedAt).toLocaleString('de-DE')}
            </p>
          )}
        </div>
        {!isAcknowledged && !props.isFinalized && (
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => props.onAck('APPROVED')}
              disabled={props.isSelf}
              title={props.isSelf ? t('wp.notiz.selfAckBlocked') : ''}
              className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
            >
              {t('wp.actions.approveNotiz')}
            </button>
            <button
              type="button"
              onClick={() => props.onAck('REJECTED')}
              disabled={props.isSelf}
              className="rounded-md bg-rose-600 px-2 py-1 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-40"
            >
              {t('wp.actions.rejectNotiz')}
            </button>
            <button
              type="button"
              onClick={() => props.onAck('NEEDS_REVISION')}
              disabled={props.isSelf}
              className="rounded-md bg-amber-600 px-2 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-40"
            >
              {t('wp.actions.needsRevisionNotiz')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusAmpel(props: { passed: number; warnung: number; kritisch: number }) {
  const t = useTranslations();
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="rounded-full bg-emerald-100 px-2 py-1 font-medium text-emerald-700">
        {t('wp.dashboard.tablePassed')}: {props.passed}
      </span>
      <span className="rounded-full bg-amber-100 px-2 py-1 font-medium text-amber-700">
        {t('wp.dashboard.tableWarnung')}: {props.warnung}
      </span>
      <span className="rounded-full bg-rose-100 px-2 py-1 font-medium text-rose-700">
        {t('wp.dashboard.tableKritisch')}: {props.kritisch}
      </span>
    </div>
  );
}

function ReportModal(props: {
  report: WPReport;
  onClose: () => void;
}) {
  const t = useTranslations();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
      <div className="w-full max-w-3xl rounded-md bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 p-4">
          <h3 className="text-lg font-semibold text-slate-900">
            {t('wp.report.title')}
          </h3>
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-md bg-slate-100 px-3 py-1 text-sm text-slate-700 hover:bg-slate-200"
          >
            ✕
          </button>
        </div>
        <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap p-4 text-xs text-slate-700">
          {props.report.markdownReport}
        </pre>
      </div>
    </div>
  );
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'PASSED':
    case 'APPROVED':
      return 'bg-emerald-100 text-emerald-700';
    case 'WARNUNG':
    case 'NEEDS_REVISION':
    case 'IN_PROGRESS':
    case 'PENDING':
      return 'bg-amber-100 text-amber-700';
    case 'KRITISCH':
    case 'REJECTED':
      return 'bg-rose-100 text-rose-700';
    default:
      return 'bg-slate-100 text-slate-700';
  }
}

function notizStatusToRegelStatus(s: WPNotiz['status']): string {
  // Mapping notiz-status to badge-class key set.
  if (s === 'APPROVED') return 'APPROVED';
  if (s === 'REJECTED') return 'REJECTED';
  if (s === 'NEEDS_REVISION') return 'NEEDS_REVISION';
  return 'PENDING';
}

// Reference IDW regel codes so a tree-shaker doesn't drop them.
void IDW_REGEL_CODES;