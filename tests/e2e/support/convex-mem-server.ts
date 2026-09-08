/**
 * Backend Convex **en mémoire**, servi en HTTP — pour les tests Playwright
 * authentifiés sans déploiement Convex.
 *
 * `convex-test` exécute les VRAIES fonctions de `convex/**` (schéma appliqué,
 * index actifs) mais seulement depuis un process de test. Ce module l'expose
 * derrière le protocole HTTP du `ConvexHttpClient` : il suffit de pointer
 * `NEXT_PUBLIC_CONVEX_URL` dessus pour que Next parle à une base neuve, locale
 * et jetable.
 *
 * Trois endpoints hors protocole (`/__test__/…`) complètent le tableau : reset,
 * appel de fonctions **internes** (interdit par le protocole public, mais
 * indispensable au seeding — `convex/seed.ts` n'expose que des
 * `internalMutation`) et lecture de la boîte d'envoi e-mail.
 *
 * Lancement : voir `tests/e2e/support/README.md`.
 * Ce fichier est réservé aux tests : ni `app/`, ni `lib/`, ni `convex/`,
 * ni `tests/unit/**` ne l'importent.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import { convexToJson, jsonToConvex, ConvexError, type Value } from 'convex/values';
import schema from '../../../convex/schema';
import { clearEmails, readEmails } from './email-actions-double';

/* -------------------------------------------------------------------------- */
/*  Modules Convex                                                             */
/* -------------------------------------------------------------------------- */

/**
 * `import.meta.glob` vient de Vite, pas des types de `tsc`. Déclaration
 * volontairement identique (au caractère près) à celle de
 * `tests/integration/utils/convex-harness.ts` : deux augmentations d'une même
 * interface ne fusionnent que si les membres ont exactement le même type.
 */
declare global {
  interface ImportMeta {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
}

/**
 * Le glob DOIT rester écrit littéralement : Vite le réécrit statiquement en un
 * objet de `() => import(...)`. Une variable ne marcherait pas.
 */
const convexModules = import.meta.glob('../../../convex/**/*.*s');

/**
 * `convex/emailActions.ts` porte `'use node'` (SDK AWS SES) : convex-test ne
 * peut pas l'exécuter. On substitue un double qui capture les envois.
 */
const EMAIL_ACTIONS_SUFFIX = '/convex/emailActions.ts';
const emailActionsKey = Object.keys(convexModules).find((p) => p.endsWith(EMAIL_ACTIONS_SUFFIX));
if (!emailActionsKey) {
  throw new Error(`Module introuvable dans le glob : *${EMAIL_ACTIONS_SUFFIX}`);
}

const modules: Record<string, () => Promise<unknown>> = {
  ...convexModules,
  [emailActionsKey]: () => import('./email-actions-double'),
};

/** Préfixe commun (`../../../convex/`), déduit comme le fait convex-test. */
const MODULES_ROOT = (() => {
  const generated = Object.keys(modules).find((p) => p.includes('_generated'));
  if (!generated) {
    throw new Error(
      'Répertoire "_generated" absent du glob — lancer `pnpx convex dev --once` (codegen).',
    );
  }
  return generated.split('_generated', 2)[0] as string;
})();

/** Même map, clés sans extension : `emailActions` → loader. */
const modulesByStem = new Map<string, () => Promise<unknown>>(
  Object.entries(modules).map(([p, load]) => [
    p.slice(MODULES_ROOT.length).replace(/\.[^.]+$/, ''),
    load,
  ]),
);

type UdfType = 'query' | 'mutation' | 'action';

/** Résout `"affiliate:createAffiliate"` vers l'export enregistré, si présent. */
async function loadRegisteredFunction(path: string): Promise<Record<string, unknown> | undefined> {
  const [file, exportName = 'default'] = path.split(':');
  const load = modulesByStem.get(file ?? '');
  if (!load) return undefined;
  const mod = (await load()) as Record<string, unknown>;
  const fn = mod[exportName];
  return typeof fn === 'function' || (typeof fn === 'object' && fn !== null)
    ? (fn as Record<string, unknown>)
    : undefined;
}

/* -------------------------------------------------------------------------- */
/*  Instance en mémoire                                                        */
/* -------------------------------------------------------------------------- */

type Harness = ReturnType<typeof convexTest>;

let harness: Harness = convexTest(schema, modules);

function reset(): void {
  harness = convexTest(schema, modules);
  clearEmails();
}

async function runUdf(type: UdfType, path: string, args: Record<string, Value>): Promise<unknown> {
  switch (type) {
    case 'query':
      return harness.query(makeFunctionReference<'query'>(path), args);
    case 'mutation': {
      const value = await harness.mutation(makeFunctionReference<'mutation'>(path), args);
      await drainScheduled();
      return value;
    }
    case 'action': {
      const value = await harness.action(makeFunctionReference<'action'>(path), args);
      await drainScheduled();
      return value;
    }
  }
}

/**
 * `convex-test` ne fait pas tourner le scheduler tout seul : sans ça, les 19
 * `ctx.scheduler.runAfter(0, …)` du code (notifications, rappels, moderation…)
 * ne partiraient jamais et un test verrait un état figé à mi-parcours.
 *
 * Un échec dans une fonction planifiée ne remonte pas à l'appelant en prod : on
 * le logue sans casser la réponse HTTP.
 */
async function drainScheduled(): Promise<void> {
  try {
    await harness.finishInProgressScheduledFunctions();
  } catch (error) {
    console.warn('[convex-mem] fonction planifiée en échec :', error);
  }
}

/* -------------------------------------------------------------------------- */
/*  Plomberie HTTP                                                             */
/* -------------------------------------------------------------------------- */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw.trim() === '') return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

/** Encodage de sortie : `undefined` n'est pas une valeur Convex → `null`. */
function encode(value: unknown): unknown {
  return value === undefined ? null : convexToJson(value as Value);
}

/**
 * Réponse d'échec au format attendu par `ConvexHttpClient` : HTTP 200 avec
 * `status: "error"` (le client accepte 200 comme 560, cf. `http_client.js`).
 *
 * Seul le MESSAGE de l'erreur sort — jamais la pile. Les tests assertent sur
 * les codes métier (`INVITE_EXPIRED`, `REWARD_TYPE_MISMATCH`…), qui sont des
 * messages ; la pile n'apporterait rien et exposerait l'arborescence du
 * serveur (c'est ce que relève `js/stack-trace-exposure`).
 */
function udfError(res: ServerResponse, error: unknown): void {
  const message = error instanceof Error ? error.message : 'Erreur inattendue';
  const data = error instanceof ConvexError ? (error.data as Value) : undefined;
  sendJson(res, 200, {
    status: 'error',
    errorMessage: message,
    ...(data !== undefined ? { errorData: convexToJson(data) } : {}),
    logLines: [],
  });
}

/**
 * Échec de plomberie (corps illisible, route qui jette) : le détail reste dans
 * les logs du serveur, la réponse ne porte qu'un libellé générique.
 */
function plumbingError(res: ServerResponse, error: unknown): void {
  console.error('[convex-mem] requête en échec :', error);
  sendJson(res, 500, { status: 'error', errorMessage: 'INTERNAL_ERROR', logLines: [] });
}

/** Décode les args : tableau à un élément, encodé Convex sur `/api/*`. */
function decodeArgs(body: Record<string, unknown>, convexEncoded: boolean): Record<string, Value> {
  const raw = Array.isArray(body.args) ? (body.args[0] ?? {}) : (body.args ?? {});
  const decoded = convexEncoded ? jsonToConvex(raw as never) : raw;
  if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)) {
    throw new Error("Les arguments d'une fonction Convex doivent être un objet");
  }
  return decoded as Record<string, Value>;
}

async function handleUdf(
  req: IncomingMessage,
  res: ServerResponse,
  type: UdfType,
  { allowInternal }: { allowInternal: boolean },
): Promise<void> {
  const body = await readBody(req);
  const path = typeof body.path === 'string' ? body.path : '';
  if (!path) {
    sendJson(res, 400, { status: 'error', errorMessage: 'Missing "path"' });
    return;
  }

  if (!allowInternal) {
    // Le vrai backend refuse les fonctions internes sur le protocole public :
    // on reproduit le refus, sinon un test passerait ici et casserait en prod.
    const fn = await loadRegisteredFunction(path);
    if (fn?.isInternal === true) {
      sendJson(res, 400, {
        status: 'error',
        errorMessage: `Could not find public function for '${path}'. Did you forget to run \`npx convex dev\` or use \`internal.${path.replace(':', '.')}\` instead of \`api.${path.replace(':', '.')}\`?`,
      });
      return;
    }
  }

  const encoded = body.format === 'convex_encoded_json' || body.format === undefined;
  try {
    const args = decodeArgs(body, encoded);
    const value = await runUdf(type, path, args);
    sendJson(res, 200, { status: 'success', value: encode(value), logLines: [] });
  } catch (error) {
    udfError(res, error);
  }
}

async function handleTestCall(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req);
  const type = body.type as UdfType | undefined;
  const path = typeof body.path === 'string' ? body.path : '';
  if (!type || !['query', 'mutation', 'action'].includes(type) || !path) {
    sendJson(res, 400, {
      status: 'error',
      errorMessage: 'Attendu : { type: "query"|"mutation"|"action", path, args? }',
    });
    return;
  }
  try {
    // `args` en JSON nu par défaut (plus lisible en curl) ; encodage Convex
    // disponible via `format: "convex_encoded_json"` pour les valeurs typées.
    const args = decodeArgs(body, body.format === 'convex_encoded_json');
    const value = await runUdf(type, path, args);
    sendJson(res, 200, { status: 'success', value: encode(value), logLines: [] });
  } catch (error) {
    udfError(res, error);
  }
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const { pathname } = url;
  const method = req.method ?? 'GET';

  if (method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  if (method === 'POST' && pathname === '/api/query') {
    return handleUdf(req, res, 'query', { allowInternal: false });
  }
  if (method === 'POST' && pathname === '/api/mutation') {
    return handleUdf(req, res, 'mutation', { allowInternal: false });
  }
  if (method === 'POST' && pathname === '/api/action') {
    return handleUdf(req, res, 'action', { allowInternal: false });
  }

  if (method === 'POST' && pathname === '/__test__/reset') {
    reset();
    sendJson(res, 200, { ok: true });
    return;
  }
  if (method === 'POST' && pathname === '/__test__/call') {
    return handleTestCall(req, res);
  }
  if (pathname === '/__test__/emails') {
    if (method === 'GET') {
      sendJson(res, 200, { emails: readEmails() });
      return;
    }
    if (method === 'DELETE') {
      sendJson(res, 200, { cleared: clearEmails() });
      return;
    }
  }
  if (method === 'GET' && pathname === '/__test__/health') {
    sendJson(res, 200, { ok: true, modules: modulesByStem.size, emails: readEmails().length });
    return;
  }

  sendJson(res, 404, { status: 'error', errorMessage: `No route for ${method} ${pathname}` });
}

/* -------------------------------------------------------------------------- */
/*  Démarrage                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Valeurs par défaut : ce backend ne parle qu'à des tests, mais plusieurs
 * fonctions Convex exigent ces variables (URL absolue dans les e-mails, secret
 * du webhook Stripe, signature de désinscription). Jamais d'écrasement d'une
 * valeur déjà posée par l'environnement.
 */
function applyTestEnvDefaults(): void {
  const defaults: Record<string, string> = {
    E2E_MODE: '1',
    APP_BASE_URL: process.env.NEXT_PUBLIC_APP_URL ?? 'http://127.0.0.1:3000',
    NEXT_PUBLIC_APP_URL: process.env.APP_BASE_URL ?? 'http://127.0.0.1:3000',
    CONVEX_WEBHOOK_SECRET: 'test-webhook-secret',
    SESSION_SECRET: 'test-session-secret',
  };
  for (const [key, value] of Object.entries(defaults)) {
    process.env[key] ??= value;
  }
}

export function startConvexMemServer(): Promise<{ port: number; close: () => Promise<void> }> {
  applyTestEnvDefaults();
  const port = Number(process.env.CONVEX_MEM_PORT ?? 3210);
  const host = process.env.CONVEX_MEM_HOST ?? '127.0.0.1';

  const server = createServer((req, res) => {
    void route(req, res).catch((error: unknown) => {
      plumbingError(res, error);
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      console.log(`[convex-mem] http://${host}:${port} — ${modulesByStem.size} modules Convex`);
      resolve({
        port,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

export { readEmails, clearEmails };

// Auto-démarrage quand le module est l'entrée du process (`vite-node
// tests/e2e/support/convex-mem-server.ts`). Via `serve.mjs`, c'est le lanceur
// qui appelle `startConvexMemServer()`.
if (typeof process !== 'undefined' && /convex-mem-server\.[cm]?ts$/.test(process.argv[1] ?? '')) {
  void startConvexMemServer();
}
