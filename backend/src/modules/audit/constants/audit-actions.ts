/**
 * Audit-Action Konstanten.
 *
 * Das Prisma-Schema definiert `auditLog.action` als `String`. Diese Datei
 * bildet die dokumentierte Action-Menge als TypeScript-Union-Type ab.
 * Validiert werden Audit-Einträge serverseitig nicht — eine ungültige
 * Action würde über die `no-restricted-syntax`-Regel im ESLint-Setup
 * auffallen (Konvention).
 */
export const AUDIT_ACTIONS = [
  'CREATE',
  'READ',
  'UPDATE',
  'DELETE',
  'SIGN',
  'SUBMIT',
  'LOGIN',
  'LOGOUT',
  'EXPORT',
] as const;

export type AuditActionLiteral = (typeof AUDIT_ACTIONS)[number];

/**
 * Type-Guard — kapselt den Vergleich.
 */
export function isAuditAction(value: string): value is AuditActionLiteral {
  return (AUDIT_ACTIONS as readonly string[]).includes(value);
}

/**
 * Cast-Helper (analog `asGlobalRole`).
 */
export function asAuditAction(value: string): AuditActionLiteral {
  return isAuditAction(value) ? value : 'READ';
}
