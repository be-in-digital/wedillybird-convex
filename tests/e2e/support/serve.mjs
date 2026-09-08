/**
 * Lanceur du backend Convex en mémoire.
 *
 * `convex-mem-server.ts` contient un `import.meta.glob` : il ne peut être
 * chargé que par Vite, qui réécrit ce glob statiquement. `vite-node` ferait
 * l'affaire mais n'est PAS installé ici (vitest 4 ne l'embarque plus), et
 * `tsx`/`node --strip-types` laisseraient `import.meta.glob` intact → crash au
 * runtime. On monte donc un serveur Vite en mode « middleware » (aucun port
 * ouvert par Vite lui-même) et on charge le module via son pipeline SSR.
 *
 *   node tests/e2e/support/serve.mjs
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '../../..');

/**
 * `vite` n'est pas une dépendance directe : avec pnpm il n'est donc pas à la
 * racine de `node_modules`. On le cherche là où il vit réellement (celui de
 * vitest en priorité, pour partager exactement la même version).
 */
function resolveVite() {
  const candidates = [
    () => require.resolve('vite'),
    () =>
      require.resolve('vite', { paths: [path.dirname(require.resolve('vitest/package.json'))] }),
    () => require.resolve('vite', { paths: [path.join(ROOT, 'node_modules/.pnpm/node_modules')] }),
  ];
  for (const attempt of candidates) {
    try {
      return attempt();
    } catch {
      /* candidat suivant */
    }
  }
  throw new Error('Impossible de résoudre `vite`. Installer vite (ou vite-node) en devDependency.');
}

const vite = await import(pathToFileURL(resolveVite()).href);

const server = await vite.createServer({
  root: ROOT,
  configFile: false, // pas de vite.config à la racine : on reste explicite
  appType: 'custom',
  logLevel: 'warn',
  resolve: { tsconfigPaths: true }, // alias `@/*` utilisés par lib/**
  server: { middlewareMode: true, hmr: false, watch: null },
});

try {
  const mod = await server.ssrLoadModule('/tests/e2e/support/convex-mem-server.ts');
  const { close } = await mod.startConvexMemServer();

  const shutdown = async () => {
    await close();
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} catch (error) {
  await server.close();
  throw error;
}
