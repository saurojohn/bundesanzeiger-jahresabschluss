/**
 * Konfigurations-Konstanten für TOTP.
 *
 * `TOTP_WINDOW_SECONDS` ist die Gültigkeitsdauer eines TOTP-Codes
 * (Standard: 30 Sekunden gemäß RFC 6238). `WINDOW_STEPS` definiert,
 * wie viele Schritte vor/zurück noch akzeptiert werden (Clock-Drift).
 */
export const TOTP_WINDOW_SECONDS = 30;
export const WINDOW_STEPS = 1;
