'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiFetch, getAccessToken } from '@/lib/api';

type ApiKey = {
  id: string;
  kanzleiId: string;
  name: string;
  keyId: string;
  scopes: string[];
  rateLimit: number;
  expiresAt: string | null;
  isActive: boolean;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
};

type CreateResponse = {
  apiKey: ApiKey;
  plaintextSecret: string;
};

const ALL_SCOPES = [
  'mandant:read',
  'bilanz:read',
  'bilanz:write',
  'guv:read',
  'guv:write',
  'anhang:read',
  'jahresabschluss:read',
  'jahresabschluss:write',
  'banz-submission:write',
  'webhook:manage',
] as const;

/**
 * API-Keys-Management-View (M4 Sprint 1).
 *
 * Features:
 *   - Liste aller API-Keys der Kanzlei
 *   - "+ Neuen API-Key" Modal mit Name + Scopes-Auswahl + Rate-Limit + Expiry
 *   - Plaintext-Secret einmalig nach Create anzeigen
 *   - Revoke-Button mit Bestätigung
 */
export function ApiKeysView() {
  const t = useTranslations();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createdSecret, setCreatedSecret] = useState<CreateResponse | null>(
    null,
  );
  const [revokingId, setRevokingId] = useState<string | null>(null);

  useEffect(() => {
    void loadKeys();
  }, []);

  async function loadKeys(): Promise<void> {
    const token = getAccessToken();
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<ApiKey[]>('/api-keys', { accessToken: token });
      setKeys(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleRevoke(id: string, name: string): Promise<void> {
    const token = getAccessToken();
    if (!token) return;
    const confirmed = window.confirm(
      t('apiKeys.confirm.revoke', { name }),
    );
    if (!confirmed) return;
    setRevokingId(id);
    try {
      await apiFetch<void>(`/api-keys/${id}`, {
        method: 'DELETE',
        accessToken: token,
      });
      await loadKeys();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRevokingId(null);
    }
  }

  if (loading) {
    return (
      <div className="text-sm text-slate-500">{t('common.loading')}</div>
    );
  }

  return (
    <div>
      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="mb-4 flex justify-end">
        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          {t('apiKeys.actions.create')}
        </button>
      </div>

      {createdSecret && (
        <PlaintextSecretModal
          data={createdSecret}
          onClose={() => {
            setCreatedSecret(null);
            void loadKeys();
          }}
        />
      )}

      {showCreateModal && (
        <CreateApiKeyModal
          onClose={() => setShowCreateModal(false)}
          onCreated={(res) => {
            setShowCreateModal(false);
            setCreatedSecret(res);
          }}
        />
      )}

      {keys.length === 0 ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-6 py-8 text-center text-sm text-slate-500">
          {t('apiKeys.empty')}
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                  {t('apiKeys.table.name')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                  {t('apiKeys.table.keyId')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                  {t('apiKeys.table.scopes')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                  {t('apiKeys.table.status')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                  {t('apiKeys.table.createdAt')}
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-slate-500">
                  {t('apiKeys.table.actions')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {keys.map((k) => (
                <tr key={k.id}>
                  <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-slate-900">
                    {k.name}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">
                    {k.keyId}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {k.scopes.join(', ')}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs">
                    {k.revokedAt ? (
                      <span className="rounded-full bg-red-100 px-2 py-1 text-red-700">
                        {t('apiKeys.status.revoked')}
                      </span>
                    ) : k.isActive ? (
                      <span className="rounded-full bg-green-100 px-2 py-1 text-green-700">
                        {t('apiKeys.status.active')}
                      </span>
                    ) : (
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-700">
                        {t('apiKeys.status.inactive')}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">
                    {new Date(k.createdAt).toLocaleDateString('de-DE')}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-xs">
                    {!k.revokedAt && (
                      <button
                        type="button"
                        disabled={revokingId === k.id}
                        onClick={() => handleRevoke(k.id, k.name)}
                        className="text-red-600 hover:text-red-800 disabled:opacity-50"
                      >
                        {t('apiKeys.actions.revoke')}
                      </button>
                    )}
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

function CreateApiKeyModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (res: CreateResponse) => void;
}) {
  const t = useTranslations();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>([]);
  const [rateLimit, setRateLimit] = useState(1000);
  const [expiresAt, setExpiresAt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const token = getAccessToken();
    if (!token) return;
    if (!name.trim() || scopes.length === 0) {
      setError(t('apiKeys.errors.missingFields'));
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      // Hole kanzleiId über first mandant (Pilot-Phase)
      const mandanten = await apiFetch<Array<{ id: string }>>('/mandant', {
        accessToken: token,
      });
      const mandant = mandanten[0];
      if (!mandant) {
        setError(t('branding.errors.noMandant'));
        return;
      }
      const mandantDetail = await apiFetch<{ kanzleiId: string }>(
        `/mandant/${mandant.id}`,
        { accessToken: token },
      );

      const res = await apiFetch<CreateResponse>('/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        accessToken: token,
        body: JSON.stringify({
          kanzleiId: mandantDetail.kanzleiId,
          name: name.trim(),
          scopes,
          rateLimit,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
        }),
      });
      onCreated(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  function toggleScope(s: string): void {
    setScopes((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-md bg-white p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">
            {t('apiKeys.modal.createTitle')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
            aria-label={t('common.close')}
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
                htmlFor="name"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                {t('apiKeys.fields.name')}
              </label>
              <input
                id="name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('apiKeys.placeholders.name')}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <span className="mb-2 block text-sm font-medium text-slate-700">
                {t('apiKeys.fields.scopes')}
              </span>
              <div className="grid grid-cols-2 gap-2">
                {ALL_SCOPES.map((s) => (
                  <label
                    key={s}
                    className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={scopes.includes(s)}
                      onChange={() => toggleScope(s)}
                    />
                    <code className="font-mono text-xs">{s}</code>
                  </label>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="rateLimit"
                  className="mb-1 block text-sm font-medium text-slate-700"
                >
                  {t('apiKeys.fields.rateLimit')}
                </label>
                <input
                  id="rateLimit"
                  type="number"
                  min={1}
                  max={100_000}
                  value={rateLimit}
                  onChange={(e) => setRateLimit(Number(e.target.value))}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label
                  htmlFor="expiresAt"
                  className="mb-1 block text-sm font-medium text-slate-700"
                >
                  {t('apiKeys.fields.expiresAt')}
                </label>
                <input
                  id="expiresAt"
                  type="date"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
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
              {submitting ? t('common.loading') : t('apiKeys.modal.submit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PlaintextSecretModal({
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
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">
            {t('apiKeys.modal.secretTitle')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
            aria-label={t('common.close')}
          >
            ✕
          </button>
        </div>

        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {t('apiKeys.modal.secretWarning')}
        </div>

        <div className="mb-4">
          <label
            htmlFor="apiKeyId"
            className="mb-1 block text-sm font-medium text-slate-700"
          >
            {t('apiKeys.modal.keyId')}
          </label>
          <input
            id="apiKeyId"
            type="text"
            readOnly
            value={data.apiKey.keyId}
            className="w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-sm"
          />
        </div>

        <div className="mb-4">
          <label
            htmlFor="secret"
            className="mb-1 block text-sm font-medium text-slate-700"
          >
            {t('apiKeys.modal.secret')}
          </label>
          <div className="flex gap-2">
            <input
              id="secret"
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
              {copied ? t('apiKeys.modal.copied') : t('apiKeys.modal.copy')}
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {t('apiKeys.modal.tokenFormat', {
              format: `${data.apiKey.keyId}.${data.plaintextSecret}`,
            })}
          </p>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            {t('apiKeys.modal.gotIt')}
          </button>
        </div>
      </div>
    </div>
  );
}