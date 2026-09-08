# Analytics produit & marketing — PostHog

Système de suivi des visiteurs pour **décider quoi optimiser dans le marketing** (où le funnel perd des gens, quels CTA/offres/langues convertissent). Conforme RGPD (société FR).

- **Projet PostHog** : `Default project` (id `469980`), org `Wedilly Bird`, **US cloud** (`us.posthog.com`).
- **Dashboard** : [Funnel Marketing & Conversion](https://us.posthog.com/project/469980/dashboard/1711205) (10 insights, épinglé).
- **MCP** : le serveur `posthog` est connecté (requêtes, insights, funnels). Skills `posthog-*` installés globalement.

## Architecture

| Pièce | Fichier | Rôle |
|---|---|---|
| Init client | `instrumentation-client.ts` | Init PostHog avant hydratation (Next 15.3+). **Pas de `PostHogProvider`** (incompatible). |
| Config + API client | `lib/analytics/posthog-client.ts` | `initPostHogClient`, `track`, `analytics.*`, `identifyUser`, `setAnalyticsConsent`, `captureException`. |
| Taxonomie | `lib/analytics/events.ts` | Constantes d'events + types (pur, importable client & serveur). |
| API serveur | `lib/analytics/posthog-server.ts` | `captureServer({distinctId,event,properties})` (Node SDK, flush immédiat). |
| Index client | `lib/analytics/index.ts` | `import { analytics } from '@/lib/analytics'`. |
| Identité | `components/analytics/posthog-identify.tsx` | Monté dans `(app)/layout.tsx` → `identify(userId, {role, plan_tier, locale, account_age_days})`. |
| Vue-au-montage | `components/analytics/track-on-mount.tsx` | Event « vue » sur une page server (ex. `invitation_viewed`). |
| Consentement | `components/layout/cookie-consent.tsx` | Pilote l'opt-in/opt-out PostHog. |
| Reverse proxy | `next.config.ts` (`/ingest/*`) | Anti-adblock, CSP `connect-src 'self'`. |

## RGPD / consentement (important)

PostHog démarre en **`opt_out_capturing_by_default: true`** → **aucune capture ni cookie** tant que le visiteur n'a pas cliqué « Accepter » dans la bannière (`localStorage['wedillybird-cookie-consent']`). À l'acceptation : opt-in + session replay + capture du pageview courant. Au refus : opt-out. `person_profiles: 'identified_only'` (anonymes = events sans profil).

**Chargement paresseux (sept. 2026)** : `posthog-js` n'est téléchargé (chunk séparé, `import()` dynamique) que si le consentement est déjà « accepté » au chargement de la page, ou au clic « Accepter ». Un visiteur qui refuse ou ignore la bannière ne charge jamais le SDK. Les appels `track` / `identifyUser` émis pendant le chargement sont mis en file d'attente et rejoués.

**Conséquence à garder en tête** : PostHog ne voit que les visiteurs qui acceptent la bannière (typiquement 30 à 60 % d'une audience française). **Pour les volumes (visites, pages vues, pays, referrers), la vérité terrain est Vercel Web Analytics** (`@vercel/analytics`, monté dans `app/[locale]/layout.tsx`) : sans cookie ni identifiant persistant, donc hors périmètre du consentement. À activer une fois sur le projet Vercel (Project → Analytics → Enable) — sans ça, le composant est inerte. PostHog garde son rôle pour le funnel, les events produit, les heatmaps et le replay des consentants.

## Taxonomie des events

| Event | Déclencheur | Propriétés clés |
|---|---|---|
| `$pageview` / `$pageleave` | auto (history change) | — |
| `cta_clicked` | clic CTA | `source`, `destination`, `plan?`, `billing?`, `audience?` |
| `pricing_plan_selected` | clic carte forfait | `tier`, `audience`, `billing?` |
| `pricing_billing_toggled` | toggle mensuel/annuel | `billing`, `audience` |
| `faq_opened` | ouverture FAQ | `question`, `source` |
| `signup_started` | entrée `/sign-up` | `method?`, `plan?`, `billing?` |
| `signup_completed` | **nouveau** compte (OTP client / email serveur) | `method` (`whatsapp`/`email`) |
| `onboarding_completed` | onboarding fini | `role` |
| `checkout_started` | **serveur** `/api/checkout` | `plan`, `currency`, `amount_minor` |
| `purchase_completed` | **serveur** webhook Stripe | `plan`, `currency`, `amount_minor`, `revenue`, `$set.plan_tier` |
| `newsletter_subscribed` | **serveur** `/api/newsletter` | `source`, `$set.email` |
| `contact_form_submitted` | formulaire contact | — |
| `invitation_viewed` | page invitation publique | `white_label` |
| `rsvp_submitted` | RSVP invité | `status` |
| `gallery_viewed` / `gallery_photo_uploaded` | galerie invités | — |

`signup_completed` / `purchase_completed` (email) sont **côté serveur** (fiables même avec adblock). `signup_completed` ne se déclenche que pour un **nouveau** compte (`isNewUser` renvoyé par `verifyOtp`/`verifyMagicLink`), pas une reconnexion.

## Ajouter un event

1. Ajouter la constante dans `lib/analytics/events.ts` + une méthode typée dans `analytics` (`posthog-client.ts`).
2. Client : `import { analytics } from '@/lib/analytics'; analytics.monEvent({...})`. Serveur : `captureServer({ distinctId: userId, event: EVENTS.x, properties })`.
3. Les events anonymes se rattachent à l'utilisateur via `identify` (déjà câblé dans `(app)/layout.tsx`).

## Mise en production (à faire)

1. **Vercel env** (Production + Preview) : `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com`, `POSTHOG_KEY`, `POSTHOG_HOST=https://us.i.posthog.com`. Sans ça, aucune capture en prod (le dashboard reste vide).
2. **Session Replay** : OFF au niveau projet (`session_recording_opt_in: false`). L'activer dans PostHog → Settings → Replay pour stocker les enregistrements (le client les démarre déjà à l'opt-in).
3. Vérifier l'ingestion : visiter le site, accepter les cookies, regarder « Activity » dans PostHog.
