# Wedillybird — Backlog

Items différés au fil des sprints. Chacun est **drop-in** : la plomberie applicative est déjà en place, seul le câblage final reste.

## Production / Vercel — checklist mise en prod

> **À me rappeler dès que l'utilisateur parle de "faire la production" / "go live" / "déployer en prod"**. Ne jamais lancer un deploy sans avoir validé chaque item ci-dessous.

### Env vars Vercel (Production + Preview)
Reproduire `.env.local` sur Vercel → Project Settings → Environment Variables :

- **Convex** : `CONVEX_DEPLOY_KEY` (généré dans Convex dashboard), `NEXT_PUBLIC_CONVEX_URL` (URL du déploiement prod), `NEXT_PUBLIC_CONVEX_SITE_URL`
- **Session** : `SESSION_SECRET` (`openssl rand -hex 32`, **distinct** du dev)
- **Stripe** (live mode) : `STRIPE_SECRET_KEY` (`sk_live_…`), `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (`pk_live_…`), `STRIPE_PRICE_ESSENTIAL`, `STRIPE_PRICE_PREMIUM`, `STRIPE_PRICE_POST_EVENT_UPSELL` (B2C 29/59/29 €), `STRIPE_PRICE_STARTER`/`STRIPE_PRICE_BUSINESS`/`STRIPE_PRICE_AGENCY` (mensuel 99/219/449 €) + `STRIPE_PRICE_*_ANNUAL` (annuel -20%) + `STRIPE_PRICE_PAYG_EVENT` (Pay-as-you-go 79 €). Tous générés par `scripts/sync-stripe-prices.ts`.
- **AWS / SES** : `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION=eu-west-3`, `AWS_ACCOUNT_ID`, `SES_FROM_ADDRESS=noreply@wedillybird.com`, `SES_CONFIGURATION_SET=wedillybird-default`, `EMAIL_DRIVER=ses`
- **S3 / CloudFront** : `S3_BUCKET=wedillybird-media-prod`, `CLOUDFRONT_DOMAIN=media.wedillybird.com`, `CLOUDFRONT_DISTRIBUTION_ID=E3O56ZG0J0BA9J`
- **Lambda** : `LAMBDA_CALLBACK_SECRET`
- **WhatsApp** (quand template prod validé) : `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_OTP_TEMPLATE`, `WHATSAPP_INVITE_TEMPLATE`
- **Contact inbox** (optionnel, sinon default codé) : `CONTACT_INBOX_EMAIL=hello@wedillybird.com`

### Bloqueurs prod externes
0. **Demo bypass OTP à retirer post-tournage** — env vars `DEMO_BYPASS_PHONE` + `DEMO_BYPASS_CODE` posées sur le déploiement Convex **dev** (`capable-crocodile-720`) pour le tournage de la vidéo de lancement (compte `+33600000001` / event `sarah-marc-launch-demo`). Bypass actif uniquement si les **deux** env vars sont set ET que le téléphone matche exactement. Une fois la vidéo livrée : `pnpx convex env unset DEMO_BYPASS_PHONE && pnpx convex env unset DEMO_BYPASS_CODE`. Ces env vars NE DOIVENT JAMAIS être posées sur le déploiement prod `fearless-poodle-133`.
1. **SES sortie de sandbox** — ✅ **RÉSOLU** (2026-06-06, vérifié API 2026-06-12 : production access, 50 000/j, 14 msg/s, état HEALTHY, suppression-list bounce+complaint active en eu-west-3). Monitoring CloudWatch (event destination + alarmes BounceRate/ComplaintRate) → SNS `hello@wedillybird.com` en place.
2. **Stripe Customer Portal** — ✅ **RÉSOLU** : configuration live active (annulation + update + moyen de paiement), vérifié 2026-06-12.
4. **DNS wildcard `*.wedillybird.com`** — Vercel domain + registrar, requis pour multi-tenant pro (sous-domaines `slug.wedillybird.com`).
5. **WhatsApp template `team_invitation`** — à créer + valider dans Meta Business Manager.
6. **Boîte `hello@wedillybird.com`** — ✅ MX configuré (Zoho : `mx.zoho.eu`, `mx2`, `mx3`), vérifié 2026-06-12. Reçoit bien (utilisé pour les alertes SES SNS).
7. **Pricing alignment** — ✅ **TERMINÉ** (2026-06-12). Code aligné + Stripe Prices live créés/alignés (30 Prices canoniques actifs EUR/USD/MAD), anciens Prices aux mauvais montants archivés, env vars `STRIPE_PRICE_*` Vercel pointant sur les bons IDs (alias sans devise re-pointés). Vérifié via l'API Stripe (0 transaction live à ce jour).
8. **Rotation clé AWS** `AKIAXCZRV3YXAVVRYIWU` — clé déjà exposée en dev, à rotater avant ouverture trafic prod (cf. "Rotation de l'access key initiale").
9. **Ouverture commerciale US (USD)** — code prêt (region `americas`, currency `USD`, pricing $39 / $99 / +$59 B2C ; $89 / $179 / $349 pros), `scripts/sync-stripe-prices.ts` étendu pour USD ✅. Bloqueurs **externes uniquement** :
   - **Stripe Tax** activation côté compte + monitoring nexus par état (Wayfair : seuil typique $100k OU 200 transactions par état → obligation de collecter sales tax). Tant que le launch US n'est pas effectif on peut shipper le code, mais on n'envoie pas de trafic acquisition US sans ça.
   - **Stripe Cross-currency settlement** — vérifier que le compte Stripe a l'option activée, sinon tous les paiements USD sont convertis en EUR au taux du jour avec frais 2 %.
   - **Stripe Prices USD à créer** — lancer `pnpx tsx scripts/sync-stripe-prices.ts` côté Stripe live (idempotent, le script crée 1 Price par devise par plan). Récupérer les `STRIPE_PRICE_*_USD` imprimés sur stdout et les coller dans les env vars Vercel Production + Preview.
   - **Migration de devise pour subscriptions existantes** : statu quo = pas de migration auto. Un Pro EUR qui voyage aux US continue de payer en EUR. La page pricing affiche la grille USD aux nouveaux prospects uniquement. Toute migration de devise = action support manuelle (cancel + recreate).
10. **Stratégie pricing LATAM** (v2) — la région `americas` v1 couvre US + CA seulement. MX / BR / AR / CL paient aujourd'hui le tarif `europe` en EUR. À ouvrir dans une v2 dédiée avec devises locales (BRL, MXN) et grille adaptée pouvoir d'achat — ne pas étendre `americas` à USD pour la zone LATAM (mauvais signal).

### Pré-déploiement checklist
- [ ] CI verte sur `main` (format, lint, typecheck, unit, build, e2e)
- [ ] `pnpx convex deploy` exécuté → schema + functions à jour sur le déploiement prod
- [ ] Vercel preview URL testée manuellement (golden path : sign-up WhatsApp, magic link email, /contact, newsletter footer, RSVP `/i/[token]`, paiement test Stripe)
- [ ] DNS `wedillybird.com` pointé sur Vercel + certificat SSL provisionné
- [ ] Webhooks Stripe configurés sur le domaine prod (`https://wedillybird.com/api/webhooks/stripe`) avec le secret `STRIPE_WEBHOOK_SECRET` aligné
- [ ] Lambda Rekognition callback URL pointe sur le Convex prod (`<prod-deploy>.convex.site/lambda/photo-moderation-callback`)

### Post-déploiement checklist
- [ ] Smoke test `/contact` → vérifier réception sur `hello@wedillybird.com`
- [ ] Smoke test magic link → vérifier réception sur un email réel
- [ ] Smoke test newsletter footer → vérifier insertion Convex `newsletterSubscribers` + notif admin
- [ ] Smoke test paiement live (1 €) puis remboursé immédiatement (validation flow Stripe)
- [ ] Vérifier Sentry / monitoring branché (si applicable)
- [ ] CGU `messages/fr.json` article 4 à réécrire (mention obsolète d'une formule "gratuite" + mauvais noms Sérénité/Prestige)

## Paiements

### Stripe Subscriptions pour comptes pro (post-Sprint 7)
- **Bloqué par** : créer 3 Stripe Prices recurring (Starter 29€/mo, Business 79€/mo, Agency 199€/mo)
- **Travail** :
  - Étendre `lib/payments/drivers/stripe.ts` avec `createSubscriptionCheckout(input)` utilisant `mode: 'subscription'`
  - Câbler `customer.subscription.created/updated/deleted` dans `verifyAndParseWebhook` → mutation `organizations.updateSubscription`
  - Page `/pro/billing` avec choix de tier + customer portal Stripe
- **Schema** : déjà prêt sur `organizations.{stripeCustomerId, stripeSubscriptionId, subscriptionTier, subscriptionStatus, subscriptionPeriodEnd}`

### PDF facture (post-Sprint 6) ✅ livré
- `@react-pdf/renderer` installé.
- Composant `lib/payments/invoice.tsx` (`<InvoicePDF payment={...} />`) — en-tête Wedillybird, bloc émetteur/client, ligne plan, TVA 20 % isolée pour EUR, mention "TVA non applicable, art. 293 B du CGI" pour XOF/MAD/TND, footer mentions légales + provider.
- Route `app/api/payments/[paymentId]/invoice.pdf/route.tsx` (GET) — auth session, query Convex `paymentsInvoice:getForInvoice` (ownership = buyer OR event owner), 200 `application/pdf` attachment idempotent.
- Strings i18n dans `messages/fr.json` section `Invoice`.
- Tests : `tests/unit/lib/invoice-pdf.test.tsx` (composant + buildInvoiceNumber) + `tests/unit/app/invoice-pdf-route.test.tsx` (401/403/404/200).

## Affiliation / partenariats créatrices

Le ledger (`convex/affiliate.ts`, `affiliates` + `affiliateReferrals`) est en
place depuis la PR #68. Le lot « partnership readiness » ferme les trois trous
qui empêchaient de tenir une offre partenaire telle qu'elle est pitchée.

### Livré
- **Un code qui remise ET attribue** : `buyerDiscountBps` était persisté sur
  l'affilié mais jamais lu au checkout. Il est désormais appliqué
  (`lib/payments/affiliate-discount.ts`), fusionné avec un éventuel crédit de
  parrainage dans un coupon Stripe unique (`discounts` n'en accepte qu'un).
- **Rattrapage d'attribution** : un acheteur qui TAPE le code au checkout (sans
  cookie `wdb_ref`) est rattaché au partenaire — le code promo est relu depuis
  la session Stripe et résolu en affilié dans `payments:markSucceeded`.
- **Commission sur le net réel** : `applyReferral` recevait le prix catalogue,
  ce qui surévaluait la commission dès qu'une remise s'appliquait. Le montant
  vient maintenant de `amount_total`, sur les trois chemins de confirmation
  (webhook, cron de réconciliation, page de succès).
- **Forfait offert** : `admin:grantEventPlan` / `revokeEventPlan` posent
  `planTier` sans passer par Stripe (partenariat, démo, geste commercial),
  tracés par `events.compedPlan` + journal d'audit. La révocation refuse tout
  event portant un paiement `succeeded`.
- **Versement** : `affiliate:markReferralPaid` + bouton « Marquer versé » dans
  `/admin/affiliates` — le ledger a enfin une sortie de `vested`.
- **Espace partenaire** `/partenaire` : le partenaire voit SON lien, ses ventes
  et son dû (lecture scopée `by_owner`, aucune donnée acheteur exposée).
- **CGU du programme** : `/legal/affiliation` (11 articles, 7 locales, page
  publique et indexable — une créatrice doit pouvoir les lire AVANT d'accepter,
  alors qu'elle n'a pas encore de compte ; l'espace partenaire y renvoie).
  Chiffres tirés du code, et `tests/unit/lib/affiliation-terms.test.ts` échoue
  si une constante bouge sans que le texte suive.
  **Paramètres commerciaux à valider par le fondateur** (choisis par défaut,
  modifiables) : versement mensuel sur facture sous 30 j, seuil minimum 50 €,
  préavis de 30 j pour toute modification des conditions.
  **Assiette tranchée (2026-09-07) : HORS TAXES.** La commission portait sur le
  montant encaissé TTC (`amount_total`), donc sur de la TVA reversée à l'État.
  Elle porte désormais sur le HT : `lib/payments/vat.ts` est la source unique de
  la règle, partagée avec la facture (`invoice.tsx`) pour qu'un partenaire qui
  recalcule depuis la facture d'un couple tombe sur notre chiffre. Stripe ne
  calcule aucune taxe sur ce compte (ni `automatic_tax`, ni `tax_behavior`),
  d'où une déduction par taux plutôt qu'une lecture d'`amount_tax`. L'assiette
  est STOCKÉE (`affiliateReferrals.commissionBaseMinor`) pour rester auditable
  si le taux change, et affichée dans le ledger admin.
  Les CGU n'ont **pas** été relues par un juriste, et l'entité légale reste
  « à compléter » (cf. `Invoice.issuerSiret`).
- **Coupon Stripe auto** : `adminCreateAffiliateAction` crée le coupon + le code
  promo Stripe sous la MÊME chaîne que `affiliates.code` dès que
  `buyerDiscountBps > 0`, restreint aux produits couple (`applies_to.products`,
  immuable — on refuse plutôt que de créer trop large). Un seul code circule
  donc vraiment : par le lien il attribue en silence, tapé au checkout il
  remise ET attribue (rattrapage via `markSucceeded`). Le code est affiché au
  partenaire dans `/partenaire`, à côté de son lien — mais seulement s'il est
  réellement accepté au checkout (`shareable`), pour ne jamais lui faire
  promettre un code que Stripe refuserait. L'activation du code promo suit
  celle de l'affilié, et `adminEnsureAffiliateCouponAction` rattrape un échec
  Stripe ou un affilié ouvert avant cette bascule.

### Reste à faire
- **`scripts/create-affiliate-code.ts` redondant** — il crée un coupon Stripe
  SANS ligne d'affilié côté Convex (attribution au compteur `times_redeemed`,
  commission calculée à la main). Le chemin `/admin/affiliates` fait mieux et
  branche le ledger. À supprimer une fois qu'on est sûr qu'aucun code créé par
  ce script n'est encore en circulation.
- **Versement automatisé** (Stripe Connect Express pour les partenaires cash) —
  aujourd'hui virement manuel, acté a posteriori dans le ledger. Suffisant à
  1-2 partenaires, pas au-delà.
- **Notification partenaire** (« nouvelle vente attribuée », « commission
  acquise ») — rien n'est envoyé, le partenaire doit venir voir la page.

## Multi-utilisateurs (post-Sprint 7)

### Branding upload organisation
- Logo via Convex storage (déjà en place côté schema `organizations.logoStorageId`)
- Composant `OrganizationBranding` réutilisant `PhotoUploader` mode 'owner'
- Mutation `organizations.updateBranding` déjà câblée

### Sous-domaine wildcard `<slug>.wedillybird.com` — Code livré ✅
- **Reste à faire (infra externe)** : config DNS wildcard `*.wedillybird.com` chez le registrar + Vercel domain wildcard pointant sur l'app.
- **Code livré** :
  - `proxy.ts` détecte `<slug>.wedillybird.com` (whitelist `www`, `api`, `media`, `app`, `admin`) et rewrite vers `/orgs/[slug]/...` en gardant l'URL utilisateur. Override dev `?orgPreview=<slug>` actif sur `localhost` uniquement.
  - Route group `app/[locale]/(public-org)/orgs/[slug]/` avec `layout.tsx` qui fetch l'orga via `convexApi.findOrgBySlug`, applique le branding (logo + `--brand-primary`/`--brand-accent` en CSS vars) et `notFound()` si slug inconnu.
  - Pages servies : `event/[eventSlug]` (event public) et `i/[token]` (invitation guest sous le sous-domaine de l'orga).
  - Convex queries publiques : `organizations.findBySlug` (PII-free) et `events.findPublicEventBySlug` (filtre `status=active` + `organizationId` matching).
  - Tests : `tests/unit/middleware/proxy.test.ts` (extractOrgSlug — 14 cas) + `tests/e2e/wildcard-subdomain.spec.ts` (skip propre si pas d'orga seedée).
- **Référence** : Vercel multi-tenant docs

### Invite par lien WhatsApp auto
- Service WhatsApp existe déjà (`lib/whatsapp/`)
- À faire : après `inviteOrgMember`, envoyer template WhatsApp `team_invitation` avec lien `<host>/pro/invite/[token]`
- Template à créer dans Meta Business Manager + valider

## Check-in offline (post-Sprint 4)

### Sync queue bidirectionnelle
- État actuel : cache lecture-seule dans Dexie ; les check-ins offline ne sont pas envoyés en différé
- À faire :
  - Ajouter table `pendingCheckIns` dans Dexie (token, eventId, scannedAt)
  - Service worker (Workbox) écoute `online` → drain de la queue vers `/api/checkin/sync`
  - Route `/api/checkin/sync` qui appelle `guests.checkInByToken` en bulk avec idempotency

## Galerie (post-Sprint 5)

### ~~Migration AWS S3 + CloudFront~~ ✅ Fait (PR #12)
- Bucket `wedillybird-media-prod` (eu-west-3) + CloudFront `media.wedillybird.com`
- Action Convex `photosActions.createOwnerS3UploadUrl` / `createGuestS3UploadUrl` (presigned PUT, 5 min)
- `photos.s3Key` + index `by_s3_key`, `storageId` rendu optionnel pour fallback lecture des photos legacy
- `PhotoUploader` PUT direct vers S3 (au lieu de POST Convex storage)
- **Restant** : migration job `convex/migratePhotos.ts` pour rapatrier les éventuelles photos `_storage` legacy → S3 (idempotent, dry-run d'abord). Pas urgent tant que la dev DB n'a pas de photos en prod.

### ~~Modération Rekognition~~ ✅ Fait (PR #12)
- Lambda `WedillybirdMediaStack-ModerationFunction` déclenchée sur S3 PUT `incoming/`
- Rekognition cross-region (Lambda eu-west-3 → Rekognition eu-west-1, Bytes inline car Rekognition pas dispo en eu-west-3)
- Rejet si `Explicit Nudity / Sexual Activity / Graphic Violence / Visually Disturbing / Hate Symbols` ≥ 80 % confidence
- Callback HMAC SHA-256 vers `convex/http.ts /lambda/photo-moderation-callback` → `internal.photos.internalMarkModerated`
- Snapshot dans `photos.moderation: { source, decision, topLabel, topConfidence, labels, decidedAt }`

### Génération variantes (sharp Lambda)
- **Bloqué par** : Docker en local (libvips natif) ou layer sharp pré-construit pour ARM64 (ex. `pH200/sharp-layer`)
- **Travail** :
  - Nouvelle Lambda `variants` ou extension de `moderation` : déclenchée après `decision = approved`
  - Génère thumbnail 320 px, medium 800 px, full 2000 px en webp (mode `cover`)
  - Upload vers `processed/{photoId}/{variant}.webp`
  - Callback Convex `internalSetVariants` → `photos.variants: { thumb, medium, full }` (`s3Key` strings)
  - Galerie : `thumb` en grid, `medium` en lightbox, `full` au download
- **CDK** : utiliser `NodejsFunction` avec `bundling.nodeModules: ['sharp']` + `forceDockerBundling: true`, ou attacher un Layer ARM64 pré-construit
- **Permissions Lambda** : `s3:GetObject` sur `incoming/`, `s3:PutObject` sur `processed/`

## AWS — opérations & sécurité (post-PR #12)

### Sortie de sandbox SES (PENDING)
- Demande soumise via `aws sesv2 put-account-details --production-access-enabled` (réponse AWS sous 24-48 h)
- Surveille `admin@tuumagency.com` pour la confirmation
- Une fois acceptée : passer `EMAIL_DRIVER=mock` → `ses` sur Vercel Production / Preview
- En cas de refus : revoir use-case description, prouver opt-in et gestion bounces/complaints

### IAM scope-down avant prod élargie
- L'utilisateur `wedillybird-dev` a actuellement `AdministratorAccess` (bootstrap). À scoper avant ouverture équipe :
  - `s3:{PutObject,GetObject,DeleteObject,ListBucket}` sur `arn:aws:s3:::wedillybird-media-prod*`
  - `ses:{SendEmail,SendRawEmail}` sur `arn:aws:ses:eu-west-3:487046110766:identity/wedillybird.com`
  - `cloudfront:CreateInvalidation` sur la distribution `E3O56ZG0J0BA9J` (purge cache après suppression)
  - `rekognition:DetectModerationLabels` sur `*`
- Créer un `wedillybird-app-runtime` IAM user séparé pour Vercel (read-only sur SES, write sur S3 incoming/), distinct du `wedillybird-dev` qui sert au déploiement CDK

### Rotation de l'access key initiale
- La clé `AKIAXCZRV3YXAVVRYIWU` a transité dans des screenshots de la session de bootstrap → la rotater :
  - Créer une nouvelle clé `wedillybird-dev` via console
  - Mettre à jour `.env.local`, Vercel (`AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` Production + Preview), Convex env
  - Désactiver l'ancienne clé puis la supprimer après 24 h sans erreur

## Infrastructure de tests

### Convex env vars shadow `.env.local` côté dev — résolu via `E2E_MODE` ✅
- Découvert pendant les tests anti-doublon (avril 2026) : le déploiement Convex dev `capable-crocodile-720` a `WHATSAPP_ACCESS_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID` définis en env vars Convex.
- Conséquence : même quand `.env.local` du projet Next.js commente WhatsApp pour activer le mock, les actions Convex (qui tournent côté Convex cloud, pas Next.js) utilisaient l'env vars Convex et envoyaient des messages réels via Meta Cloud API. Le retour `provider: 'meta_cloud'` dans `auth.requestOtp / auth.requestLinkPhone` était le tell.
- **Solution livrée** : flag `E2E_MODE=1` checké côté `lib/whatsapp/index.ts:createWhatsAppClient`, `lib/email/index.ts:getEmailDriver`, `convex/auth.ts:requestOtp / requestLinkPhone`, `convex/emailActions.ts:dispatch`. Quand le flag est posé, tous les drivers retombent sur le mock peu importe les credentials.
- **Procédure E2E** :
  ```bash
  pnpx convex env set E2E_MODE 1                       # côté Convex deployment dev
  pnpm exec playwright test                             # le webServer Playwright pose déjà E2E_MODE=1 côté Next.js
  pnpx convex env unset E2E_MODE                        # restauration à la fin
  ```
- Helpers E2E-only ajoutés : `auth:_e2eIssueLinkPhoneCode` / `auth:_e2eIssueLinkEmailCode` (génèrent un OTP de linking et renvoient le code en clair, garde `process.env.E2E_MODE === '1'` côté handler).

### Test E2E linking happy path
- Couvert par tests unit + Convex CLI tests (4 anti-doublon ✅, 1 happy-path partiel ✅, 1 verify check ✅).
- Spec Playwright `tests/e2e/auth-linking.spec.ts` créée — couvre le scénario heureux (seed user email-only → mock OTP via `_e2eIssueLinkPhoneCode` → verify) et l'erreur `PHONE_TAKEN`.
- État actuel : la mécanique d'injection de session magic-link UI complète n'est pas encore câblée → la spec UI est `test.skip()` proprement avec un commentaire expliquant le pré-requis (route `/api/dev/sign-in-by-email`). La logique de génération de code mock est validée côté Convex CLI (helpers utilisables).
- À programmer dans un sprint dédié : exposer un endpoint `/api/dev/sign-in-by-email` (équivalent `/api/dev/login` mais email-based) pour permettre le test UI sans avoir à mocker la réception du magic link.

### Test "vraie vie" préprod (Vercel preview)
- Une fois le preview Vercel déployé, faire le scénario complet avec un vrai numéro + un vrai email :
  - Sign-up via magic link → onboarding → dashboard → carte "Activer WhatsApp" → ajouter numéro → réception SMS WhatsApp → saisie code → vérifier user.phone patché
  - Bonus : tester le rejet `PHONE_TAKEN` avec un numéro déjà pris en prod
- Bloqué par : déploiement preview Vercel (cf. checklist Production en haut)

### Détection de doublons users — script d'audit ✅
- Internal query `users:_scanDuplicates` ajoutée à `convex/users.ts`. Lance via :
  ```bash
  unset CONVEX_DEPLOYMENT CONVEX_URL CONVEX_SITE_URL
  export CONVEX_DEPLOYMENT="dev:capable-crocodile-720"
  pnpx convex run users:_scanDuplicates
  ```
- Heuristique : groupement par `fullName.toLowerCase().trim()`, score 100 si email identique, 80 si phone normalisé identique, 50 si juste fullName.
- Read-only — aucune fusion automatique. Loggue les 50 paires top-score côté Convex log + retourne le rapport.
- À lancer manuellement de temps en temps. Si paires trouvées, fusion à coder dans un sprint dédié (cf. fusion auto / merge UX dashboard).

## Templates WhatsApp Cloud API

### Contexte
Tout message WhatsApp envoyé via Meta Cloud API à un user qui n'a pas initié la conversation **doit utiliser un template pré-approuvé**. Cycle :

1. Soumission via Meta Business Manager (catégorie `authentication` / `utility` / `marketing`)
2. Validation Meta sous 24-48h (refus possibles si texte non conforme)
3. Une fois approuvé, appelable via API avec `template.name` + `language.code` + `components.parameters`
4. Nom unique par WABA → impossible d'avoir 2 templates `wedding_invitation` différents

### Templates système à créer
Tous nommés en `snake_case`, créés une fois côté Wedillybird, validés Meta, stockés dans env var (déjà le pattern `WHATSAPP_OTP_TEMPLATE=otp_code`) :

| Nom | Catégorie | Usage | Variables | État |
|---|---|---|---|---|
| `otp_code` | authentication | Login WhatsApp + linking | code | ✅ utilisé |
| `team_invitation` | utility | Pro invite collaborateur | prénom invité, nom inviteur, nom orga | 📤 Codé dans `scripts/submit-whatsapp-templates.ts` — soumission Meta à lancer |
| `wedding_invitation_*` (5 styles) | marketing | Invitation couple → invités | prénom, couple, date, mot perso | 📤 Codé — soumission Meta à lancer |
| `template_status_update` | utility | Notif couple sur validation/refus de leur template custom | prénom, nom template, statut, raison | 📤 Codé — soumission Meta à lancer |
| `rsvp_reminder_d7` | utility | Rappel J-7 invités `attending` qui ne sont pas confirmés | prénom invité, prénoms couple, date | 📤 Codé — soumission Meta à lancer |
| `rsvp_reminder_d1` | utility | Rappel veille | prénom invité, prénoms couple, lieu | 📤 Codé — soumission Meta à lancer |
| `rsvp_confirmation` | utility | Accusé réception après que l'invité a répondu RSVP | prénom invité, statut RSVP, prénoms couple | 📤 Codé — soumission Meta à lancer |

**Lancer la soumission** :
```bash
# 1. Preview des payloads (no-op API)
pnpx tsx scripts/submit-whatsapp-templates.ts --dry-run

# 2. Soumettre un seul template ciblé
WHATSAPP_ACCESS_TOKEN=EAAxxx WHATSAPP_WABA_ID=123456 \
  pnpx tsx scripts/submit-whatsapp-templates.ts --template team_invitation

# 3. Soumettre tout (idempotent : skip si déjà existant côté Meta)
WHATSAPP_ACCESS_TOKEN=EAAxxx WHATSAPP_WABA_ID=123456 \
  pnpx tsx scripts/submit-whatsapp-templates.ts
```

### Personnalisation par le couple — décision architecture pending
Trois options pour permettre au couple de personnaliser son message d'invitation :

**Option A — Templates Wedillybird-only (recommandé MVP)**
Le couple choisit parmi 3-4 styles préfabriqués (formel, chaleureux, africain, minimal) + remplit les variables (prénoms, mot perso libre dans une variable text de 60 chars max). Pas de soumission Meta côté couple. Simple, rapide.

**Option B — Templates 100% custom par couple**
Le couple écrit son texte complet, Wedillybird le soumet à Meta via API Business Management, attend la validation, puis envoie. Complexe : workflow asynchrone, gestion des refus, nom unique par WABA (suffixe couple slug ?), 24-48h d'attente avant que l'invitation puisse partir.

**Option C — Hybrid**
Default templates Wedillybird-prefab + option "template custom" réservée à un tier supérieur (Premium ou tier dédié). Coût/effort plus élevé, mais l'attente de validation est explicite.

Décision à prendre avant d'implémenter : recommander A pour le MVP, garder B/C en option Pro post-MVP.

### Travail à faire (un fois option choisie)
- Créer les 5 templates dans Meta Business Manager + soumettre pour validation
- Stocker les noms validés dans env vars (`WHATSAPP_INVITATION_TEMPLATE`, `WHATSAPP_REMINDER_D7_TEMPLATE`, etc.)
- Étendre `lib/whatsapp/meta-cloud.ts` avec une fonction générique `sendTemplate({ to, templateName, languageCode, components })`
- (Si Option A) UI pour choisir le style + saisir variables + preview
- (Si Option B/C) Workflow Convex de soumission Meta + polling validation + notif au couple quand approuvé
- Mutation cron qui scanne `guests` éligibles aux rappels et envoie via WhatsApp (déjà partiellement câblé pour SES dans `convex/reminders.ts`, à dupliquer pour WhatsApp)

## Refactoring critique (avant prod élargie)

### Pricing alignment Stripe Prices ✅ (multi-devises)
- Source de vérité : `.context/redesign-direction.md` section "Pricing figé"
- État actuel :
  - `lib/payments/plans.ts` aligné (Essentiel 29€, Premium 59€, +29€ upsell post-mariage) ✅
  - `lib/payments/subscriptions.ts` aligné sur la grille pros (Starter 99€/Business 219€/Agency 449€/mo + variantes annuelles -20% arrondies au € supérieur + Pay-as-you-go 79€/event one-shot) — étendus avec `prices: Record<Currency, number>` (EUR/XOF/MAD/TND) ✅
  - `convex/schema.ts` : ajout `events.pendingPlanTier` (forfait choisi avant paiement) ✅
  - Étape "Choisir votre forfait" ajoutée dans `EventCreateWizard` (couple uniquement, pro saute) ✅
  - Bouton Publier disabled tant qu'aucun paiement enregistré ✅
  - Helpers `priceIdForPlan(plan, currency)` (B2C) et `priceIdForTier(tier, billing, currency)` (Pro mensuel/annuel) — multi-devises avec rétro-compat env legacy ✅
  - Driver Stripe one-shot préfère `STRIPE_PRICE_<PLAN>_<CURRENCY>` (puis legacy `STRIPE_PRICE_<PLAN>` comme alias EUR) quand l'env var existe (fallback `price_data` sinon) ✅
  - `tierForPriceId(priceId)` retourne désormais `{ tier, billing, currency }` et reconnaît les variantes `_MAD` / `_TND` ✅
  - Script ops `scripts/sync-stripe-prices.ts` étendu : crée 1 Price Stripe par devise supportée (EUR + MAD + TND), idempotent, `--dry-run`, tolère les devises non supportées par le compte (warning + skip) ✅
  - Stripe Prices EUR + MAD générés en TEST sur le compte Wedillybird ✅
- À faire côté Stripe (live mode) :
  - Lancer `pnpx tsx scripts/sync-stripe-prices.ts --dry-run` pour preview, puis sans flag pour appliquer
  - Mettre à jour `STRIPE_PRICE_*_EUR` / `STRIPE_PRICE_*_MAD` / `STRIPE_PRICE_*_TND` env vars dev + Vercel (le script imprime le bloc copy-pastable)
  - Tester le checkout sur chaque tier × devise supportée
- TND : **non créé** côté compte test actuel (compte Stripe Wedillybird n'a pas de bank account TND → erreur `Invalid currency: tnd`). Pour activer le marché Tunisie : ouvrir un bank account TND dans Stripe Dashboard puis relancer le script. Tant qu'il n'y a pas de Price TND, le driver tombe sur `price_data` inline pour TND (fonctionnel mais sans Price stable).
- XOF : devise d'affichage uniquement, sans processeur de paiement (non supporté). Le script ne crée pas de Price XOF côté Stripe et le checkout n'accepte pas cette devise.
- Pay-as-you-go pro **code-side** : MVP livré ✅
  - Schema : `organizations.paygCredits` (nb crédits non-consommés) + table `paygPurchases` (idempotent par `stripeSessionId`)
  - Action server `payAsYouGoAction` + carte UI sur `/pro/billing` ("Acheter un crédit", 69 €)
  - Driver Stripe `createPaygCheckout` (mode `payment`, metadata `kind=payg`)
  - Webhook handler étendu : `payg.purchased` → `paygPurchases:markPurchase` (incrémente `paygCredits`)
  - Mutation Convex `paygPurchases:markPurchase` + query `getCreditsByOrganization`
  - Badge "N crédit(s) dispo" sur la page billing pro
- **Reste à faire pour PAYG** :
  - Gating à la création/publication d'event sous PAYG : décrémenter `paygCredits` quand l'orga sans subscription crée un event, refuser si `paygCredits === 0`. Aujourd'hui le crédit est tracé mais ne contraint rien — il faut le brancher dans `events:create` ou `events:publish` côté Convex.
  - Notification email "Crédit PAYG activé" à l'achat (similaire à `renderProNotification kind=payment-received`).
  - Historique des achats PAYG dans le dashboard pro (table `paygPurchases` à exposer en query).

### CGU article 4 — réécriture ✅
- `messages/fr.json:40` réécrit pour la grille canonique (Essentiel 29 €, Premium 59 €, Upsell +29 €, plans pros 99/219/449 €/mo, PAYG 79 €). Mention Stripe, remboursement 100 % sous 7j, report gratuit en cas d'annulation.

## Câblage métier emails (post-PR #12)

La plomberie `lib/email/` est en place avec drivers SES + mock et 3 templates. Reste à brancher dans le code applicatif :

### Rappel invité (`renderGuestReminder`)
- Cron Convex (action) qui scanne `guests` avec `rsvpStatus='attending'` et `event.eventDate - now() ∈ [7d±1h, 1d±1h]`
- Pour chaque match : `sendEmail({ to: guest.email, ... renderGuestReminder({ daysUntilEvent: 7|1 }) })`
- Champ `guests.lastReminderSentAt` (à ajouter au schema) pour éviter les doublons

### Notification pro (`renderProNotification`)
- `team-member-added` : depuis `organizations.inviteOrgMember` mutation
- `payment-received` : depuis `payments.markSucceeded` (webhook Stripe)
- `subscription-renewed` / `subscription-failed` : depuis le futur câblage Stripe Subscriptions (cf. section Paiements)

### Facture Stripe (`renderStripeInvoice`)
- Bloqué par item « PDF facture » (cf. Paiements) — l'email peut linker vers la page hosted invoice de Stripe en attendant le PDF self-hosted

## Galerie — recherche par visage (face search) — câblage et cleanup

État livré (avril 2026) :
- Schema : `events.faceCollectionId` + table `photoFaces` (`by_photo`/`by_event`/`by_face`)
- Lambda `infra/lambdas/moderation.ts` : ensure collection + IndexFaces (max 5 par photo) + callback HMAC distinct vers `/lambda/photo-faces-callback`. Best-effort : un échec face indexing ne bloque pas la modération
- Convex HTTP : `/lambda/photo-faces-callback` + mutation interne `photos:internalRegisterPhotoFaces` (idempotente sur `photoId + faceId`)
- Action publique `photos:searchPhotosByFace({ eventId, selfieBase64, requesterId?, guestToken? })` : autorisation owner / collaborator / guestToken, distingue `NO_FACE_DETECTED` / `NO_COLLECTION_YET` / `FORBIDDEN` / `INVALID_TOKEN` / `UNKNOWN`. Le selfie n'est jamais persisté
- IAM Lambda CDK : ajout `CreateCollection`, `DescribeCollection`, `IndexFaces`, `DeleteCollection`
- Tests unitaires : `tests/unit/convex/face-search.test.ts` (23 cases : decode, wrapper Rekognition, response builder)

À faire :
- **Cleanup à la suppression event** : la mutation `events:remove` / `events:archive` n'existe pas encore. Quand elle sera ajoutée, déclencher `internal.photosFaceSearch.deleteFaceCollection({ collectionId: event.faceCollectionId })` après suppression DB pour libérer la collection Rekognition (sinon = leak côté AWS, ~5 c$/mois par 1000 visages stockés)
- **Cleanup `photoFaces` à la suppression d'une photo individuelle** : `photos:remove` ne supprime aujourd'hui que la photo + l'objet S3, pas les rows `photoFaces` associées. À ajouter (boucle index `by_photo` → ctx.db.delete) + `Rekognition.DeleteFaces` pour libérer les Face IDs côté AWS
- **IAM utilisateur AWS Convex (`wedillybird-dev` / `wedillybird-app-runtime`)** : ajouter `rekognition:SearchFacesByImage` + `rekognition:DeleteFaces` au scope-down listé dans la section "AWS — opérations & sécurité" (l'action Convex utilise `AWS_ACCESS_KEY_ID/SECRET` côté Convex env, pas le rôle IAM Lambda)
- **UI Agent B** : composant `<FaceSearchModal />` qui prend webcam/file → base64 → server action → galerie filtrée par `photoIds`. Placer le bouton "Retrouver mes photos" sur `/i/[token]/gallery` (côté guest) ET `/events/[id]/gallery` (côté owner pour debug)
- **Quota / rate-limit** : aucun quota par event ou par invité aujourd'hui. À considérer si abus (selfies répétés) — typiquement debounce côté UI + soft-limit Convex sur `searchPhotosByFace` par `requesterId` ou `guestToken` sur fenêtre 1 min

## Plan de table / gestion des tables — ✅ LIVRÉ (V1 + V2 + V2.1)

> **Livré (juin 2026)** sur `/events/[id]/seating`, feature Premium + tous les Pro (`seatingPlan`), Essentiel exclu → upsell. Exposé dans la grille tarifaire B2C.

**V1 — board drag-and-drop** (`@dnd-kit/core`) : colonne « non placés » + cartes tables droppables, assignation en glisser-déposer (pointer + tactile + clavier), capacité éditable + alerte sur-capacité, ajout/suppression de table. Optimiste + revert serveur.

**V2 — plan visuel + automatisation + export** :
- **Plan visuel spatial** : vue « Plan » (canvas), nœuds tables positionnables en drag (posX/posY persistés), forme ronde/rectangulaire commutable. Toggle Liste ⇄ Plan.
- **Placement automatique** : `convex/lib/autoplace.ts` (regroupe par catégorie, respecte la capacité, crée les tables manquantes) + mutation `autoAssignGuests`.
- **Export/impression** : route `/seating/print` (document propre, sauts de page propres) + bouton.

**V2.1 — placement par personne** : modèle **unité-personne**. L'invité principal (`memberIndex 0`) reste sur `guests.tableId` ; chaque accompagnant (`memberIndex ≥ 1`) est placé **indépendamment** via la table `tableAssignments`. Chaque personne = une place.

**Functions** : `convex/seating.ts` (createTable / updateTable / deleteTable / assignSeat / autoAssignGuests / getSeatingPlan), owner-ou-collaborateur + entitlement gated. **Tests** : unit (board + autoplace) + e2e Playwright (gating, drag, auto-place, plan + repositionnement, plus-one indépendant).

**Reste (améliorations futures, non bloquant)** :
- Auto-placement plus fin : RSVP liés, **gestion de conflits** (« ne pas asseoir X près de Y »), équilibrage.
- Réordonnancement des tables en drag dans la vue Liste (la vue Plan couvre déjà le repositionnement).
- Export **PDF** natif (aujourd'hui = impression navigateur depuis `/seating/print`).
- Nettoyage des `tableAssignments` orphelines si un accompagnant est retiré du RSVP (best-effort).
