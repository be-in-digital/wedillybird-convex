# Backend Convex en mémoire (tests Playwright)

`convex-mem-server.ts` sert les VRAIES fonctions de `convex/**` (via `convex-test`) sur HTTP, sans déploiement : base neuve à chaque démarrage, e-mails capturés au lieu d'être envoyés — `convex/emailActions.ts`, en `'use node'`, est remplacé par `email-actions-double.ts`.

```bash
node tests/e2e/support/serve.mjs &                          # port 3210 (CONVEX_MEM_PORT pour changer)
NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3210 pnpm test:e2e  # Playwright démarre Next et propage l'URL
```

`serve.mjs` monte un serveur Vite en mode middleware : `import.meta.glob` n'est réécrit que par Vite, et `vite-node` n'est pas installé (vitest 4 ne l'embarque plus).

| Endpoint                            | Usage                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------- |
| `POST /api/query\|mutation\|action` | protocole `ConvexHttpClient` (fonctions **publiques** seulement)            |
| `POST /__test__/call`               | `{type, path, args}` — accepte aussi les fonctions **internes** (seeding)   |
| `POST /__test__/reset`              | instance vierge (base + boîte d'envoi)                                      |
| `GET\|DELETE /__test__/emails`      | e-mails capturés `{to, subject, html, text, sentAt}` / purge                |

Les `ctx.scheduler.runAfter(0, …)` sont drainés après chaque mutation/action. Limite : pas de WebSocket, donc les 4 composants client en `useQuery` (cloche de notifications, panneau, stats live, lien partenaire) restent vides — tout le rendu serveur (`ConvexHttpClient`) fonctionne.
