import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { Request } from 'express';
import { requireMandantId, resolveMandantId } from './resolve-mandant-id';

type MandantRequest = Request & {
  activeMandantId?: string;
  body?: Record<string, unknown>;
  params?: Record<string, string | string[]>;
  query?: Record<string, unknown>;
};

/**
 * Tests der mandantId-Aufloesung.
 *
 * Fehlerklasse, die hier abgesichert wird: der MandantGuard akzeptiert vier
 * Quellen (params, Header, Query, Body), die Controller lasen aber jeweils nur
 * eine Teilmenge. Daraus entstanden 500er (Bare Error) und 403 "Kein Zugriff
 * auf diesen Mandanten", obwohl der Mandant authorisiert war. Diese Tests
 * halten fest, dass Header und Query austauschbar sind — der Weg, den das
 * Frontend geht (apiFetch setzt `x-mandant-id`).
 */
function request(overrides: Partial<MandantRequest> = {}): MandantRequest {
  return {
    headers: {},
    body: undefined,
    query: {},
    params: {},
    ...overrides,
  } as unknown as MandantRequest;
}

describe('resolveMandantId', () => {
  it('liest die mandantId aus dem x-mandant-id-Header', () => {
    const req = request({
      headers: { 'x-mandant-id': 'mandant-a' } as MandantRequest['headers'],
    });
    expect(resolveMandantId(req)).toBe('mandant-a');
  });

  it('liest die mandantId aus dem Query-Parameter (Listen-Endpunkte)', () => {
    const req = request({ query: { mandantId: 'mandant-a' } });
    expect(resolveMandantId(req)).toBe('mandant-a');
  });

  it('liest die mandantId aus dem Body-Feld', () => {
    const req = request({ body: { mandantId: 'mandant-a' } });
    expect(resolveMandantId(req)).toBe('mandant-a');
  });

  it('liest die mandantId aus params', () => {
    const req = request({ params: { mandantId: 'mandant-a' } });
    expect(resolveMandantId(req)).toBe('mandant-a');
  });

  it('bevorzugt den vom Guard validierten Wert vor allen anderen Quellen', () => {
    const req = request({
      activeMandantId: 'mandant-geprueft',
      headers: { 'x-mandant-id': 'mandant-header' } as MandantRequest['headers'],
      query: { mandantId: 'mandant-query' },
      body: { mandantId: 'mandant-body' },
    });
    expect(resolveMandantId(req)).toBe('mandant-geprueft');
  });

  it('bevorzugt params vor Header, Query und Body', () => {
    const req = request({
      params: { mandantId: 'mandant-params' },
      headers: { 'x-mandant-id': 'mandant-header' } as MandantRequest['headers'],
      query: { mandantId: 'mandant-query' },
      body: { mandantId: 'mandant-body' },
    });
    expect(resolveMandantId(req)).toBe('mandant-params');
  });

  it('bevorzugt den Header vor Query und Body', () => {
    const req = request({
      headers: { 'x-mandant-id': 'mandant-header' } as MandantRequest['headers'],
      query: { mandantId: 'mandant-query' },
      body: { mandantId: 'mandant-body' },
    });
    expect(resolveMandantId(req)).toBe('mandant-header');
  });

  it('ignoriert leere Werte und faellt auf die naechste Quelle zurueck', () => {
    const req = request({
      headers: { 'x-mandant-id': '' } as MandantRequest['headers'],
      activeMandantId: '',
      query: { mandantId: 'mandant-query' },
    });
    expect(resolveMandantId(req)).toBe('mandant-query');
  });

  it('ignoriert Nicht-String-Werte', () => {
    const req = request({ query: { mandantId: ['a', 'b'] } });
    expect(resolveMandantId(req)).toBeUndefined();
  });

  it('liefert undefined, wenn keine Quelle die mandantId enthaelt', () => {
    expect(resolveMandantId(request())).toBeUndefined();
  });

  it('liefert undefined bei einem Request ohne body/query/params (POST ohne Rumpf)', () => {
    const req = { headers: {} } as unknown as MandantRequest;
    expect(resolveMandantId(req)).toBeUndefined();
  });
});

describe('requireMandantId', () => {
  it('gibt die mandantId aus dem Header zurueck', () => {
    const req = request({
      headers: { 'x-mandant-id': 'mandant-a' } as MandantRequest['headers'],
    });
    expect(requireMandantId(req)).toBe('mandant-a');
  });

  it('wirft 400 und nicht 500, wenn die mandantId fehlt', () => {
    // Der Fehler entsteht durch die Anfrage des Clients. Ein nackter `Error`
    // wuerde als HTTP 500 "Internal server error" ausgeliefert und die
    // Meldung verschlucken — genau das war der urspruengliche Defekt.
    expect(() => requireMandantId(request())).toThrow(BadRequestException);
    try {
      requireMandantId(request());
      expect.unreachable('requireMandantId muss hier werfen');
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as BadRequestException).getStatus()).toBe(400);
      expect((err as BadRequestException).message).toContain('x-mandant-id');
    }
  });
});
