import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 3000);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;
const isCI = !!process.env.CI;

/**
 * Backend Convex EN MÉMOIRE — opt-in via `CONVEX_MEM=1`.
 *
 * Sans lui, `NEXT_PUBLIC_CONVEX_URL` vaut une sentinelle non résolvable et
 * toute page authentifiée est hors de portée : c'est l'état par défaut, et la
 * raison pour laquelle une large part de la suite se saute. Avec lui, les
 * VRAIES fonctions de `convex/**` tournent en local (cf.
 * `tests/e2e/support/README.md`) et les e-mails sont capturés — ce qui rend la
 * connexion par magic link automatisable, donc les parcours authentifiés
 * testables.
 *
 * Opt-in délibérément : l'activer par défaut ferait basculer d'un coup toute
 * la suite aujourd'hui skippée, sans qu'elle ait été écrite pour cette pile.
 */
const useMemBackend = process.env.CONVEX_MEM === '1';
const MEM_PORT = Number(process.env.CONVEX_MEM_PORT ?? 3210);
const MEM_URL = `http://127.0.0.1:${MEM_PORT}`;
/** Les deux serveurs DOIVENT s'accorder sur l'hôte : le lien de connexion est
 *  construit avec, et un cookie de session posé sur `127.0.0.1` ne serait pas
 *  renvoyé à `localhost`. */
const APP_URL = baseURL;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@wedillybird.test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  // CI : 1 seul worker. À 2 workers, chromium + webkit tournaient en parallèle
  // sur le même runner (+ un seul serveur Next), et la contention faisait échouer
  // les tests sensibles au timing sur webkit-Linux (scroll-spy `aria-current`,
  // focus après collage OTP) même après retries. Sérialiser supprime la
  // contention au prix d'un job plus lent — fiabilité > vitesse pour ce gate.
  //
  // `CONVEX_MEM` impose la même sérialisation, pour une raison plus dure : le
  // backend en mémoire est UNIQUE pour tout le run et `resetBackend()` en vide
  // la base. Deux tests concurrents s'effacent mutuellement leur état en plein
  // vol — et le symptôme ne ressemble pas à sa cause (une page admin qui
  // s'affiche, puis l'action suivante en `FORBIDDEN: admin role required`).
  // Le helper de spec `useMemBackend()` (`tests/e2e/utils/mem-backend.ts`)
  // sérialise déjà sa suite, mais rien au niveau d'un `describe` ne peut
  // coordonner deux PROJETS (chromium et webkit) : seul le nombre de workers
  // le peut.
  workers: isCI || useMemBackend ? 1 : undefined,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    ...(useMemBackend
      ? [
          {
            command: 'node tests/e2e/support/serve.mjs',
            url: `${MEM_URL}/__test__/health`,
            reuseExistingServer: !isCI,
            timeout: 120_000,
            stdout: 'pipe' as const,
            stderr: 'pipe' as const,
            env: {
              CONVEX_MEM_PORT: String(MEM_PORT),
              APP_BASE_URL: APP_URL,
              NEXT_PUBLIC_APP_URL: APP_URL,
              ADMIN_EMAIL,
              CONVEX_WEBHOOK_SECRET: 'test-webhook-secret',
            },
          },
        ]
      : []),
    {
      // Mode dev exclu quand le backend est branché : le socket HMR est
      // injoignable dans un conteneur de CI, et ses échecs en boucle
      // empêchent l'hydratation — les composants client ne réagissent plus.
      command: isCI || useMemBackend ? 'pnpm start' : 'pnpm dev',
      url: baseURL,
      reuseExistingServer: !isCI,
      timeout: 180_000,
      stdout: 'pipe' as const,
      stderr: 'pipe' as const,
      env: {
        NEXT_PUBLIC_CONVEX_URL:
          process.env.NEXT_PUBLIC_CONVEX_URL ??
          (useMemBackend ? MEM_URL : 'https://invalid.convex.test'),
        APP_BASE_URL: APP_URL,
        NEXT_PUBLIC_APP_URL: APP_URL,
        ADMIN_EMAIL,
        CONVEX_WEBHOOK_SECRET: 'test-webhook-secret',
        SESSION_SECRET:
          process.env.SESSION_SECRET ?? 'test-session-secret-at-least-32-chars-long-xxxxx',
        WHATSAPP_MOCK: '1',
        // Force le driver mock côté Next.js. Pour les actions Convex (qui
        // tournent dans le cloud Convex), il faut aussi poser cette env var
        // côté deployment dev avant de lancer les tests :
        //   pnpx convex env set E2E_MODE 1
        // Cf. tests/e2e/auth-linking.spec.ts pour le pattern de teardown.
        E2E_MODE: '1',
        EMAIL_DRIVER: 'mock',
      },
    },
  ],
});
