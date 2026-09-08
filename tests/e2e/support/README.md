# Backend Convex en mémoire (tests Playwright)

`convex-mem-server.ts` sert les VRAIES fonctions de `convex/**` (via `convex-test`) sur HTTP, sans déploiement : base neuve à chaque démarrage, e-mails capturés au lieu d'être envoyés — `convex/emailActions.ts`, en `'use node'`, est remplacé par `email-actions-double.ts`.

```bash
NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3210 pnpm build   # la CSP fige l'URL Convex À LA COMPILATION
CONVEX_MEM=1 pnpm test:e2e                                # Playwright démarre le backend ET Next
```

`CONVEX_MEM=1` suffit : Playwright lance lui-même `serve.mjs` (port 3210, `CONVEX_MEM_PORT` pour changer) et pointe Next dessus.

Deux pièges, tous deux payés une fois :

- **Construire sans l'URL** laisse le WebSocket Convex hors du `connect-src` de la CSP (`next.config.ts`). Chromium se contente d'un avertissement ; WebKit lève, et perd son process de rendu en pleine hydratation — écran « This page couldn't load » sur un HTML serveur pourtant complet.
- **Exporter `NEXT_PUBLIC_CONVEX_URL` pour le run** (et pas seulement pour le build) réveille ~180 tests gardés par `requiresConvexDev()`, qui exigent un vrai deployment Convex dev : `seed:*` est en `internalMutation`, donc hors du protocole public que sert ce backend.

`serve.mjs` monte un serveur Vite en mode middleware : `import.meta.glob` n'est réécrit que par Vite, et `vite-node` n'est pas installé (vitest 4 ne l'embarque plus).

| Endpoint                            | Usage                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------- |
| `POST /api/query\|mutation\|action` | protocole `ConvexHttpClient` (fonctions **publiques** seulement)            |
| `POST /__test__/call`               | `{type, path, args}` — accepte aussi les fonctions **internes** (seeding)   |
| `POST /__test__/reset`              | instance vierge (base + boîte d'envoi)                                      |
| `GET\|DELETE /__test__/emails`      | e-mails capturés `{to, subject, html, text, sentAt}` / purge                |

Les `ctx.scheduler.runAfter(0, …)` sont drainés après chaque mutation/action. Limite : pas de WebSocket, donc les 4 composants client en `useQuery` (cloche de notifications, panneau, stats live, lien partenaire) restent vides — tout le rendu serveur (`ConvexHttpClient`) fonctionne.

Une spec s'y branche par `useMemBackend()` (`tests/e2e/utils/mem-backend.ts`), qui la sérialise en plus de la garder et de la remettre à zéro. Ce n'est pas négociable : il n'existe qu'UN backend pour tout le run, et `/__test__/reset` en vide la base — deux tests concurrents s'effacent mutuellement leur état en plein vol.
