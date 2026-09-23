import clsx, { type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const BASE_API = '/api';

type FetchOptions = RequestInit & { accessToken?: string };

export async function apiFetch<T = unknown>(
  path: string,
  options: FetchOptions = {},
): Promise<T> {
  const { accessToken, ...init } = options;
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }
  const response = await fetch(`${BASE_API}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const err = new Error(
      body.message || `HTTP ${response.status} ${response.statusText}`,
    );
    (err as Error & { status?: number; code?: string }).status = response.status;
    (err as Error & { status?: number; code?: string }).code = body.code;
    throw err;
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('accessToken');
}

export function getActiveMandantId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('activeMandantId');
}