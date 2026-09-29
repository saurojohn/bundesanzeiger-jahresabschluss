import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

/**
 * Warum unplugin-swc statt des Vite/esbuild-Defaults:
 *
 *   NestJS-DI lebt von `emitDecoratorMetadata` (design:paramtypes /
 *   design:type). Der Vite-Default-Transformer ist esbuild, und esbuild
 *   unterstuetzt emitDecoratorMetadata NICHT. Dadurch fehlte im Testlauf die
 *   komplette Konstruktor-Reflection — jeder @Injectable() bekam undefined
 *   injiziert (AuthService: "Cannot read properties of undefined (reading
 *   'get')"), und alle 13 e2e-Dateien fielen schon im collect-Phase um.
 *
 *   `ts-node` (npm run dev) und `tsc` (npm run build) emitieren die Metadata
 *   korrekt — der Produktionspfad war also nie kaputt, nur der Testpfad.
 *   Deshalb ist es hier wichtig, dass Test- und Prod-Transformation identisch
 *   sind: swc uebernimmt die TS-Optionen aus tsconfig.json inklusive
 *   emitDecoratorMetadata.
 */
export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: 'es6' },
    }),
  ],
  test: {
    globals: true,
    environment: 'node',
    include: ['e2e/**/*.spec.ts', 'src/**/*.spec.ts'],
    // Vor jedem Lauf die DB in einen definierten Ausgangszustand versetzen.
    // Ohne das ist die Suite NICHT idempotent: die Specs benutzen feste
    // Geschaeftsjahre (2024/2025) gegen einen Unique-Constraint auf
    // (mandantId, geschaeftsjahr) — der zweite Lauf auf derselben DB
    // schlaegt fehl und die Fehlerzahl waechst mit jedem Lauf.
    globalSetup: ['e2e/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // E2E-Specs starten jedes ihr eigenes Nest-TestingModule gegen dieselbe
    // Postgres-Instanz. Ohne fileParallelism laufen sie sequenziell und
    // storen sich nicht gegenseitig (z.B. auth.e2e raeumt die Session-Tabelle).
    fileParallelism: false,
  },
});
