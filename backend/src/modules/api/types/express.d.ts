/**
 * Type-Augmentation für Express-Request — Public-API-Context.
 *
 * Ermöglicht `req.apiKeyContext` typsicher zu nutzen (vom ApiKeyGuard
 * gesetzt). Wird via `tsconfig.json > include` automatisch geladen.
 */
import type { APIKeyContext } from '../services/api-key.service';

declare global {
  namespace Express {
    interface Request {
      apiKeyContext?: APIKeyContext;
    }
  }
}

export {};