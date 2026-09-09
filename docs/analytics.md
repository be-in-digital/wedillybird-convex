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

## RGPD / consentement — deux niveaux d'observation (sept. 2026)

| Niveau | Quand | Ce qui est capturé | Ce qui est écrit sur l'appareil |
|---|---|---|---|
| **Sans cookie** (`cookieless_mode: 'on_reject'`) | dès l'arrivée, et après « Continuer sans accepter » | `$pageview`, `$pageleave` (scroll, temps), `section_viewed`, `cta_clicked`, `faq_opened`, `pricing_plan_selected`, `demo_rsvp_submitted`, autocapture, web vitals | **rien** — identité = hash quotidien calculé côté serveur PostHog (`$cookieless_mode: true` sur l'event) |
| **Complet** | après « Accepter » | idem + **session replay**, heatmaps, profil (`identify` à la connexion), pixel Meta | cookie + localStorage PostHog |

Le niveau « sans cookie » est la même base que Vercel Web Analytics (exemption CNIL « mesure d'audience ») : pas de traceur déposé, pas de suivi inter-sites, finalité limitée. La bannière et `/legal/cookies` le disent explicitement. Le bouton « Continuer sans accepter » refuse le replay, le profil et Meta — pas la mesure anonyme.

**⚠️ À activer une fois dans PostHog** : Project settings → *Cookieless server hash mode* → **Enable**. Sans ça, les events sans cookie sont **ignorés à l'ingestion** (le SDK les envoie, PostHog les jette). C'est le réglage n° 1 à vérifier si le dashboard reste vide alors que Vercel Analytics compte des visites.

**Chargement** : `posthog-js` est importé dynamiquement quand le navigateur est inactif après le chargement (`requestIdleCallback`, 3 s max) — hors du chemin critique du hero. Les appels `track`/`identifyUser` émis avant sont mis en file puis rejoués. À l'acceptation, un `$pageview` est re-capturé sous la nouvelle identité avec `consent_upgrade: true` : **exclure cette propriété** des insights de volume (elle sert seulement à ce que le funnel de la personne consentante commence par une visite).

**Vercel Web Analytics** (`@vercel/analytics`, `app/[locale]/layout.tsx`) reste la vérité terrain pour les volumes bruts (visites, pays, referrers), y compris les visiteurs sans JavaScript côté PostHog. À activer sur le projet Vercel (Project → Analytics).

## Lire les données — que regarder chaque semaine

Tout est dans **`/admin/acquisition`** (clé `POSTHOG_PERSONAL_API_KEY` requise) ou dans le dashboard PostHog :

1. **Visiteurs uniques par section** (`section_viewed`, dau) — la courbe de fuite du scroll : Fonctionnalités → Tarifs → FAQ. La première marche qui perd plus de la moitié des visiteurs est la section à retravailler.
2. **Clics CTA par source** (`cta_clicked.source`) — `hero_primary`, `hero_secondary` (démo), `pricing_essential`, `pricing_premium`, `cta_final`, `header`, `nav`, `demo_banner`. Un CTA jamais cliqué est mal placé ou mal formulé.
3. **Questions FAQ ouvertes** (`faq_opened.question`) — les objections réelles. Si « Combien d'invités maximum ? » domine, la réponse doit remonter dans le pricing.
4. **Démo** (`demo_rsvp_submitted`) rapporté aux vues de `/demo` — la preuve produit convainc-t-elle ?
5. **Funnel** visite → CTA → inscription → compte → onboarding → checkout → achat — l'étape qui casse.
6. **Rejeux de session** (visiteurs consentants) — 5 minutes de replay valent plus qu'un graphique : où hésitent-ils, que survolent-ils, où partent-ils ? Activer le replay dans PostHog → Settings → Session replay.
7. **Web vitals** (`$web_vitals`) — LCP mobile de la landing ; au-delà de 2,5 s, la perf devient un sujet.

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
