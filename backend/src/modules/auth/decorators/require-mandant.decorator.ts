import { SetMetadata } from '@nestjs/common';
import { REQUIRE_MANDANT_KEY } from '../constants/auth.constants';

/**
 * Markiert einen Endpoint als mandant-id-pflichtig.
 *
 * Der MandantGuard aktiviert dann:
 *   - Header `x-mandant-id` ODER
 *   - Body-Feld `mandantId` ODER
 *   - URL-Param `mandantId`
 *
 * SYSTEM_ADMIN umgeht die Prüfung.
 */
export const RequireMandant = (): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRE_MANDANT_KEY, true);
