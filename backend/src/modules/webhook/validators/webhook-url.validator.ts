import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import { parseAndAssertPublicUrl } from '../../../common/security/ssrf-guard';

/**
 * class-validator-Decorator: URL muss ein oeffentliches http(s)-Ziel sein.
 *
 * `@IsUrl` allein ist eine reine Syntaxpruefung — sie akzeptierte
 * `http://169.254.169.254/...` (Cloud-Metadaten) und `http://127.0.0.1:5432/`.
 * Zusammen mit der auslesbaren `responseBody` ergab das ein SSRF-Primitive
 * mit Reading. Siehe `src/common/security/ssrf-guard.ts`.
 */
export function IsPublicHttpUrl(options?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isPublicHttpUrl',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string' || value.length === 0) return false;
          try {
            parseAndAssertPublicUrl(value);
            return true;
          } catch {
            return false;
          }
        },
        defaultMessage(_args: ValidationArguments): string {
          return (
            'url muss eine öffentliche HTTP/HTTPS-URL sein ' +
            '(keine internen, reservierten oder Loopback-Adressen)'
          );
        },
      },
    });
  };
}
