'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiFetch, getAccessToken } from '@/lib/api';

type WebhookSubscription = {
  id: string;
  kanzleiId: string;
  url: string;
  events: string[];
  isActive: boolean;
  createdAt: string;
  lastDeliveryAt: string | null;
  lastDeliveryStatus: number | null;
};

type WebhookDelivery = {
  id: string;
  subscriptionId: string;
  event: string;
  attemptCount: number;
  maxAttempts: number;
  status: string;
  responseCode: number | null;
  responseBody: string | null;
  errorMessage: string | null;
  scheduledAt: string;
  completedAt: string | null;
  nextRetryAt: string | null;
};

type CreateResponse = {
  subscription: WebhookSubscription;
  plaintextSecret: string;
};

const ALL_EVENTS = [
  'banz.submission.prepared',
  'banz.submission.submitted',
  'banz.submission.published',
  'banz.submission.failed',
  'bilanz.updated',
  'guv.updated',
  'anhang.updated',
  'jahresabschluss.finalized',
] as const;

export function WebhooksView() {
  const t = useTranslations();
  const [subs, setSubs] = useState<WebhookSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [created, setCreated] = useState<CreateResponse | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);

  useEffect(() => {
    void loadSubs();
  }, []);

  async function loadSubs(): Promise<void> {
    const token = getAccessToken();
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<WebhookSubscription[]>('/webhook-subscriptions', {
        accessToken: token,
      });
      setSubs(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string, url: string): Promise<void> {
    const token = getAccessToken();
    if (!token) return;
    if (!window.confirm(t('webhooks.confirm.delete', { url }))) return;
    try {
      await apiFetch<void>(`/webhook-subscriptions/${id}`, {
        method: 'DELETE',
        accessToken: token,
      });
      await loadSubs();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleTest(id: string): Promise<void> {
    const token = getAccessToken();
    if (!token) return;
    try {
      const res = await apiFetch<{ deliveryId: string }>(
        `/webhook-subscriptions/${id}/test`,
        { method: 'POST', accessToken: token },
      );
      setHistoryId(id);
      setError(t('webhooks.deliveries.testSent', { deliveryId: res.deliveryId }));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (loading) {
    return <div className="text-sm text-slate-500">{t('common.loading')}</div>;
  }

  return (
    <div>
      {error && (
        <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
          {error}
        </div>
      )}

      <div className="mb-4 flex justify-end">
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          {t('webhooks.actions.create')}
        </button>
      </div>

      {created && (
        <SecretDisplayModal
          data={created}
          onClose={() => {
            setCreated(null);
            void loadSubs();
          }}
        />
      )}

      {showCreate && (
        <CreateWebhookModal
          onClose={() => setShowCreate(false)}
          onCreated={(res) => {
            setShowCreate(false);
            setCreated(res);
          }}
        />
      )}

      {historyId && (
        <DeliveryHistoryModal
          subscriptionId={historyId}
          onClose={() => setHistoryId(null)}
        />
      )}

      {subs.length === 0 ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-6 py-8 text-center text-sm text-slate-500">
          {t('webhooks.empty')}
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                  {t('webhooks.table.url')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                  {t('webhooks.table.events')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                  {t('webhooks.table.lastDelivery')}
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-slate-500">
                  {t('webhooks.table.actions')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {subs.map((s) => (
                <tr key={s.id}>
                  <td className="max-w-md truncate px-4 py-3 text-sm font-mono text-slate-900">
                    {s.url}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {s.events.join(', ')}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">
                    {s.lastDeliveryAt
                      ? `${new Date(s.lastDeliveryAt).toLocaleString('de-DE')} (HTTP ${String(s.lastDeliveryStatus)})`
                      : '—'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-xs">
                    <button
                      type="button"
                      onClick={() => setHistoryId(s.id)}
                      className="mr-2 text-blue-600 hover:text-blue-800"
                    >
                      History
                    </button>
                    <button
                      type="button"
                      onClick={() => handleTest(s.id)}
                      className="mr-2 text-brand-600 hover:text-brand-800"
                    >
                      {t('webhooks.actions.test')}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(s.id, s.url)}
                      className="text-red-600 hover:text-red-800"
                    >
                      {t('webhooks.actions.delete')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CreateWebhookModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (res: CreateResponse) => void;
}) {
  const t = useTranslations();
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>([]);
  const [secret, setSecret] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const token = getAccessToken();
    if (!token) return;
    if (!url.trim() || events.length === 0) {
      setError(t('webhooks.errors.invalidUrl'));
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const mandanten = await apiFetch<Array<{ id: string }>>('/mandant', {
        accessToken: token,
      });
      const mandant = mandanten[0];
      if (!mandant) return;
      const md = await apiFetch<{ kanzleiId: string }>(`/mandant/${mandant.id}`, {
        accessToken: token,
      });

      const body = {
        kanzleiId: md.kanzleiId,
        url: url.trim(),
        events,
        ...(secret ? { secret: secret.trim() } : {}),
      };

      const res = await apiFetch<CreateResponse>('/webhook-subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        accessToken: token,
        body: JSON.stringify(body),
      });
      onCreated(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  function toggleEvent(ev: string): void {
    setEvents((prev) =>
      prev.includes(ev) ? prev.filter((x) => x !== ev) : [...prev, ev],
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-md bg-white p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">
            {t('webhooks.modal.createTitle')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <label
                htmlFor="url"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                {t('webhooks.modal.url')}
              </label>
              <input
                id="url"
                type="url"
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/webhooks/banz"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <span className="mb-2 block text-sm font-medium text-slate-700">
                {t('webhooks.modal.events')}
              </span>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {ALL_EVENTS.map((ev) => (
                  <label
                    key={ev}
                    className="flex items-start gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={events.includes(ev)}
                      onChange={() => toggleEvent(ev)}
                    />
                    <div>
                      <code className="font-mono text-xs">{ev}</code>
                      <p className="text-xs text-slate-500">
                        {t(`webhooks.events.${ev}`)}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label
                htmlFor="secret"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                {t('webhooks.modal.secret')} (optional)
              </label>
              <input
                id="secret"
                type="text"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="32+ Zeichen, leer = Server generiert"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
              />
            </div>
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {submitting ? t('common.loading') : t('webhooks.modal.submit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SecretDisplayModal({
  data,
  onClose,
}: {
  data: CreateResponse;
  onClose: () => void;
}) {
  const t = useTranslations();
  const [copied, setCopied] = useState(false);

  function copy(): void {
    void navigator.clipboard.writeText(data.plaintextSecret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-md bg-white p-6 shadow-lg">
        <h2 className="mb-4 text-lg font-semibold text-slate-900">
          {t('webhooks.modal.secretTitle')}
        </h2>

        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {t('webhooks.modal.secretWarning')}
        </div>

        <div className="mb-4">
          <label className="mb-1 block text-sm font-medium text-slate-700">
            {t('webhooks.modal.secret')}
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              readOnly
              value={data.plaintextSecret}
              className="w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-sm"
            />
            <button
              type="button"
              onClick={copy}
              className="rounded-md bg-slate-700 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              {copied ? '✓' : t('webhooks.actions.copyToken')}
            </button>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            {t('webhooks.modal.gotIt')}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeliveryHistoryModal({
  subscriptionId,
  onClose,
}: {
  subscriptionId: string;
  onClose: () => void;
}) {
  const t = useTranslations();
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void load();
  }, [subscriptionId]);

  async function load(): Promise<void> {
    const token = getAccessToken();
    if (!token) return;
    try {
      const data = await apiFetch<WebhookDelivery[]>(
        `/webhook-subscriptions/${subscriptionId}/deliveries`,
        { accessToken: token },
      );
      setDeliveries(data);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-4xl rounded-md bg-white p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">
            {t('webhooks.deliveries.title')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
          >
            ✕
          </button>
        </div>

        {loading ? (
          <div className="py-8 text-center text-sm text-slate-500">
            {t('common.loading')}
          </div>
        ) : deliveries.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-500">
            Noch keine Deliveries
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-slate-500">
                    Event
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-slate-500">
                    Status
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-slate-500">
                    Attempts
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-slate-500">
                    HTTP
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-slate-500">
                    Scheduled
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {deliveries.map((d) => (
                  <tr key={d.id}>
                    <td className="px-3 py-2 text-xs font-mono">{d.event}</td>
                    <td className="px-3 py-2 text-xs">
                      {t(`webhooks.deliveries.status.${d.status}`)}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {t('webhooks.deliveries.attempt', {
                        count: d.attemptCount,
                        max: d.maxAttempts,
                      })}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {d.responseCode ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      {new Date(d.scheduledAt).toLocaleString('de-DE')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}