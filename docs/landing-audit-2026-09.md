# Audit landing — trafic & conversion (8 septembre 2026)

Périmètre : la landing couple `/` (et ce qui l'entoure : mesure d'audience, SEO, entrée du tunnel d'inscription). Sources : logs runtime Vercel production (fenêtre disponible : 1er → 8 sept. 2026), config du projet Vercel, code de la branche `main` (f432225), build + rendu local de la landing, recherche web sur la marque.

**Ce qui n'a pas pu être vérifié depuis cet environnement** : les données PostHog elles‑mêmes (aucune clé `POSTHOG_*` accessible ici, pas de connecteur PostHog dans la session), les variables d'environnement Vercel (valeurs), la redirection `www → apex`, le pixel Meta en prod, la Search Console, le dashboard Stripe. Ces points sont listés en fin de document avec la marche à suivre.

---

## Verdict en trois lignes

1. **Il n'y a pratiquement pas de trafic.** Sur 7 jours, la landing a déclenché 105 rendus serveur, bots et visites du fondateur compris. Le proxy le plus fiable de « vraies sessions navigateur » (le préchargement de `/legal/cookies` par la bannière) donne **23 sessions en 7 jours, soit ≈ 3 par jour**, fondateur inclus.
2. **PostHog ne peut pas montrer ce trafic.** La capture est en opt‑out par défaut : seuls les visiteurs qui cliquent « Accepter » sont comptés (typiquement 30 à 60 % d'une audience française), et l'ingestion n'est active que si `NEXT_PUBLIC_POSTHOG_KEY` est posée en Production sur Vercel, ce que la doc du projet (`docs/analytics.md`) liste encore comme « à faire ». Vercel Web Analytics n'est pas activé (`web_analytics_not_enabled`).
3. **Le problème n° 1 n'est donc pas la conversion, c'est l'acquisition** : personne n'arrive. Mais la page telle qu'elle est ferait fuir les rares visiteurs : CTA principal sous la ligne de flottaison (desktop 1440×900 et mobile 390×844), preuve sociale inventée (« 1 240 mariages célébrés », « 4,9 / 5 ») alors qu'il y a 0 transaction, contradictions de copy, liens morts, 1,3 Mo de JavaScript.

---

## 1. Ce que les données disent

### 1.1 Trafic serveur (Vercel runtime logs, production, 7 jours)

Chaque vue de `/` déclenche une fonction serverless (page dynamique, `cache=MISS` systématique), donc ces chiffres sont une **borne haute** des pages vues.

| Route | Invocations / 7 j | Lecture |
|---|---:|---|
| `/` | 105 | ≈ 15 / jour, bots et fondateur inclus |
| `/legal/cookies` | 23 | préchargement Next du lien de la bannière → ≈ nombre de sessions navigateur réelles (≈ 3 / jour) |
| `/sign-up` | 17 | inclut les tests du fondateur |
| `/sign-in` | 15 | |
| `/verify` | 6 | |
| `/dashboard` | 6 | |
| `/pros` | 6 | |
| `/contact` | 5 | |
| `/admin/*` | ≈ 18 par page | navigation du fondateur dans le back‑office |
| `/api/cron/reconcile-payments` | 96 | cron toutes les 15 min, normal |
| 404 | 38 | scanners (`/wp-login.php`, `/config.json`, `/products.json`, `/sftp-config.json`, `/index.php`) |

Sur un échantillon de 36 h on voit aussi des `HEAD /` (monitoring/bots), un crawl allemand (`/de/contact`, `/de/legal/terms`) et une erreur `Failed to find Server Action` (un visiteur qui avait un onglet ouvert pendant un déploiement — sans conséquence).

Les locales autres que `fr` (`/en`, `/es`…) n'apparaissent pas dans le top 25 : le trafic anglophone visé par le lancement US est nul.

### 1.2 Ce que PostHog peut voir au mieux

Lecture de `lib/analytics/posthog-client.ts` et `components/layout/cookie-consent.tsx` :

- `opt_out_capturing_by_default: true` → aucun `$pageview` tant que l'utilisateur n'a pas cliqué « Accepter ». Un « Continuer sans accepter » ou une fermeture d'onglet = visiteur invisible.
- La bannière apparaît après 1,5 s ; un visiteur qui rebondit avant n'est jamais compté.
- Si `NEXT_PUBLIC_POSTHOG_KEY` est vide en prod, `initPostHogClient()` retourne silencieusement : dashboard vide, sans erreur.
- `/admin/acquisition` (la page qui devait répondre à « combien de visites ») affiche un encart de configuration tant que `POSTHOG_PERSONAL_API_KEY` n'est pas posée.

Conclusion : même si PostHog est bien câblé, il montre au mieux la moitié d'un trafic déjà minuscule. **Il ne faut pas juger l'acquisition avec PostHog seul.**

### 1.3 Mesure locale de la landing (build `main`, `next start`, Chromium)

| Métrique | Valeur |
|---|---:|
| JavaScript transféré (non compressé) | 1 316 ko |
| Document HTML | ≈ 400 ko |
| CSS | 158 ko |
| Polices | 98 ko |
| Requêtes | 35 |
| CTA « Préparer mon mariage » visible sans scroll (1440×900) | non |
| CTA visible sans scroll (390×844) | non |

Sur les deux viewports, la bannière cookies recouvre le sous‑titre (la seule phrase qui dit ce que fait le produit) et le bouton principal est hors écran.

### 1.4 Présence hors site

- Google indexe `https://www.wedillybird.com/` alors que le canonical du code est l'apex `wedillybird.com`. Il faut vérifier que `www` redirige en 308 vers l'apex (sinon contenu dupliqué).
- Sur « invitation mariage WhatsApp », la page 1 est occupée par CapCut, jaidisoui.fr, mariages.net, myinvit.com. Wedillybird n'y est pas.
- La requête de marque « wedillybird » remonte **WeddyBird** (weddybird.com, @WeddyBird sur X, GitHub) — une autre marque, quasi homonyme. Risque de confusion et de captation du trafic de marque.
- Aucun compte social, avis, article ou mention tierce trouvés.

---

## 2. Pourquoi personne n'arrive (acquisition)

1. **Aucun canal n'est actif.** Pas de contenu indexable (le `/blog` affiche 4 cartes « Lire l'article » qui ne sont pas des liens ; `/guide` et `/templates` ne sont pas dans le sitemap), pas de campagne payante identifiable, pas de présence sociale, pas de relations presse, pas de partenaires wedding planners actifs (le programme d'affiliation existe dans le code mais aucun trafic référent n'apparaît).
2. **Le SEO part de zéro** : domaine récent, landing V4 en ligne depuis le 26 juillet 2026, 9 URLs dans le sitemap × 7 locales, dont des pages légales. Rien qui puisse se positionner sur une requête d'intention.
3. **La boucle virale est bloquée par l'absence de clients** : le mécanisme « invités → prospects » (`invitation_viewed → cta_clicked`) ne démarre qu'avec des mariages réels envoyés.
4. **Le nom joue contre vous** : WeddyBird préexiste et capte la requête de marque.

---

## 3. Pourquoi les rares visiteurs n'achètent pas (landing + tunnel)

### 3.1 Au‑dessus du pli

- Le titre « Le mariage se vit dans la conversation. Faites‑le exister là. » est une thèse, pas une promesse. Un visiteur ne sait pas ce que fait le produit avant le sous‑titre — que la bannière cookies recouvre.
- L'eyebrow « CHAPITRE 01 — L'INVITATION » et la structure en chapitres sont un dispositif éditorial qui ne porte aucune information pour l'acheteur.
- Deux overlays possibles à la première visite (bannière cookies + suggestion de langue).
- Le CTA n'est pas visible sans scroll sur aucun des deux viewports testés.

### 3.2 Crédibilité

- **Chiffres inventés** : « 1 240 mariages célébrés », « 4,9 / 5 satisfaction couples », « Mesuré sur les 1 240 premiers mariages célébrés avec Wedillybird, 2026 », « 98 % des invitations ouvertes », « 73 % de RSVP en 24 h », « Plus de 92 % des grands‑parents testés ». Il y a 0 transaction (cf. `CLAUDE.md`). Trois témoignages fictifs (« Camille & Hugo » est aussi le couple de la carte de démo du hero, « Awa & Mamadou », « Studio Lumière »).
  - Un visiteur qui vérifie (Google, Instagram, Trustpilot) ne trouve rien : la confiance s'effondre au moment où elle devait se construire.
  - Juridiquement, c'est une pratique commerciale trompeuse (art. L121‑2 Code de la consommation) que la DGCCRF sanctionne.
- **Contradictions** : la FAQ promet « jusqu'à 500 invitations par mariage » alors que le pricing dit 100 (Essentiel) et 250 (Premium) ; `/templates` propose « Créer mon invitation gratuitement » alors qu'il n'y a pas de tier gratuit ; le CTA final dit « Sans carte bancaire pour explorer » (à valider : que peut‑on faire exactement avant de payer ?).
- **Liens morts ou trompeurs dans le footer** : « Démo en direct » mène à `/sign-up` ; « API & intégrations », « Lieux de réception », « Agences » pointent vers `/pros` ; le blog n'a pas d'articles.
- **Bannière cookies et page `/legal/cookies` affirment « aucun cookie de pistage tiers »** alors que l'acceptation charge PostHog (autocapture, heatmaps, session replay) et le pixel Meta. Non conforme CNIL (finalités non nommées) et, pour un visiteur attentif, une contradiction de plus.

### 3.3 Le produit n'est pas montré

Le « WoW » (cinématique d'ouverture de l'invitation) est décrit et mimé en CSS, jamais montré tel que l'invité le vivra. Aucun lien de démo publique sans compte. Pour un produit émotionnel à 29–59 €, c'est la preuve qui manque le plus.

### 3.4 Tunnel

`/` → `/sign-up` (numéro WhatsApp + OTP, ou magic link) → onboarding 2–3 étapes (profil, sécurisation, rôle) → espace couple → écran « Mon forfait » → Stripe. Le paiement est à 5 écrans du premier clic, et la première chose demandée est un numéro de téléphone, avant toute valeur perçue. Les cartes pricing envoient vers `/sign-up` sans propager le forfait choisi (le paramètre `?plan=` n'est pas passé), le tunnel repart de zéro.

### 3.5 Performance

1,3 Mo de JS (GSAP + Lenis + Motion + canvas‑confetti + carte 3D + PostHog + Recharts chargés dès la landing) et un HTML de 400 ko. Sur mobile 4G, le premier écran interactif arrive tard et l'animation d'entrée retarde encore la lecture. À corriger, mais ce n'est pas la cause de l'absence de ventes.

---

## 4. Plan d'action priorisé

L'ordre est l'ordre d'exécution : on mesure avant de changer, on rend la page honnête avant d'y envoyer du trafic.

### Semaine 1 — voir clair

| # | Action | Effort | Pourquoi |
|---|---|---|---|
| 1 | Activer **Vercel Web Analytics** sur le projet et monter `@vercel/analytics` dans `app/[locale]/layout.tsx` | 1 h | Mesure sans cookie, sans consentement, exhaustive. Devient la vérité terrain sur les volumes. |
| 2 | Vérifier sur Vercel que `NEXT_PUBLIC_POSTHOG_KEY`, `POSTHOG_KEY` et `POSTHOG_PERSONAL_API_KEY` sont posées en **Production** ; ouvrir PostHog → Activity après une visite avec « Accepter » | 30 min | Sans ça PostHog est vide en silence et `/admin/acquisition` reste en mode « configuration ». |
| 3 | Bannière cookies : nommer les finalités (mesure d'audience PostHog, publicité Meta) et corriger `/legal/cookies` | 2 h | Conformité CNIL ; supprime une contradiction visible. |
| 4 | Search Console : propriété « domaine », soumettre `sitemap.xml`, vérifier la redirection `www → apex` | 1 h | Google indexe `www` ; sans redirection, dilution. |

### Semaine 2 — rendre la page honnête et lisible

| # | Action | Effort | Pourquoi |
|---|---|---|---|
| 5 | **Retirer toute preuve sociale inventée** (chiffres, témoignages, « mesuré sur 1 240 mariages »). Remplacer par ce qui est vrai : « Nouveau en 2026 », remboursé 7 jours, report gratuit, données en Europe, le fondateur à visage découvert, 2–3 bêta‑couples réels (même offerts) | 1 j | Risque juridique et confiance. Un « Lancé en 2026 » sincère convertit mieux qu'un faux 4,9/5 invérifiable. |
| 6 | Corriger les contradictions : FAQ 500 → 100/250, « gratuitement », « sans carte bancaire pour explorer », liens footer (retirer « Démo en direct », « API », « Lieux » tant que ça n'existe pas ; retirer `/blog` tant qu'il n'a pas d'articles) | 2 h | |
| 7 | Hero : promesse concrète + CTA au‑dessus du pli. Ex. : « Vos invitations de mariage sur WhatsApp. RSVP en 30 secondes, check‑in le jour J, souvenirs partagés. » Bannière cookies compacte en bas, sans recouvrir le texte | 1 j | Un visiteur doit comprendre l'offre et pouvoir agir sans scroller. |
| 8 | **Démo publique sans compte** : `/demo` = la vraie page d'invitation (cinématique réelle, RSVP fictif), liée depuis le hero (« Voir une invitation ») | 2 j | C'est la preuve produit. Le composant existe déjà (`components/invitation/*`). |
| 9 | Propager `?plan=` depuis les cartes pricing vers `/sign-up` ; afficher le forfait choisi dans l'onboarding | 2 h | Ne pas casser l'intention d'achat. |
| 10 | Alléger : charger GSAP/Lenis/confetti/carte 3D à la demande, sortir Recharts de la landing, vérifier ce qui gonfle le HTML à 400 ko (messages i18n embarqués ?) | 1 j | Mobile 4G. |

### Mois 1 — faire venir des gens

| # | Action | Effort | Pourquoi |
|---|---|---|---|
| 11 | Écrire réellement les 4 articles annoncés (« invitation mariage WhatsApp », « faire‑part digital », « RSVP », « budget ») avec pages `/blog/[slug]`, et les ajouter au sitemap avec `/guide` et `/templates` | 3 j | Seule voie SEO ; ces requêtes ont une intention d'achat. |
| 12 | Canal direct : 10 wedding planners FR/Sénégal contactés à la main avec un compte offert (le programme partenaire existe déjà) ; groupes Facebook mariage ; 3 vidéos 9:16 de la cinématique sur Instagram/TikTok (les médias existent dans `public/cinematics`) | continu | Premiers vrais mariages = premiers vrais témoignages = démarrage de la boucle virale. |
| 13 | Test payant Meta à petit budget (pixel déjà câblé) **uniquement après** les points 5–8 | 200–300 € | Sinon on paie pour une page qui ne convertit pas. |
| 14 | Trancher la question du nom vis‑à‑vis de WeddyBird (au minimum : Google Business Profile, comptes sociaux au nom exact, page « Wedillybird ≠ WeddyBird ») | à décider | Le trafic de marque part chez un tiers. |

---

## 4 bis. Ce qui a été implémenté (9 septembre 2026, même PR)

Points du plan livrés dans le code, sur la branche de cet audit :

| # | Action | Livré |
|---|---|---|
| 1 | Vercel Web Analytics | `@vercel/analytics` monté dans `app/[locale]/layout.tsx`. **Reste à activer sur le projet Vercel** (Project → Analytics → Enable), sinon le composant est inerte. |
| 3 | Bannière cookies conforme | Finalités nommées (mesure d'audience PostHog, pixel Meta), barre compacte en bas d'écran qui ne recouvre plus le hero, page `/legal/cookies` et politique de confidentialité mises à jour (7 locales). |
| 4 | Sitemap | `/demo`, `/templates`, `/guide` ajoutés. La propriété Search Console et la redirection `www → apex` restent à faire côté Vercel/Google. |
| 5 | Preuve sociale inventée | Retirée : trust strip du hero, trois stats et « source » du manifeste, section Témoignages (composant supprimé, lien de nav retiré), trust line du CTA final, « 92 % des grands‑parents » de la FAQ. Remplacée par des garanties vérifiables (paiement unique, remboursement 7 jours, données en Europe, report gratuit). |
| 6 | Contradictions et liens | FAQ 100/250 invitations ; « Créer mon invitation » (sans « gratuitement ») ; footer : « API & intégrations », « Lieux de réception », « Agences » retirés, « Démo » pointe vers `/demo`, journal retiré et page `/blog` placeholder supprimée (aucun article réel). |
| 7 | Hero | Promesse concrète (« Vos invitations de mariage, envoyées sur WhatsApp. » + ce que fait le produit), CTA visible sans scroller à 1440×900, 1280×720 et 390×844 bannière comprise (test e2e dédié), CTA secondaire → démo. |
| 8 | Démo publique | `/demo` : la vraie page d'invitation (shell, cinématique, compte à rebours, RSVP) avec un couple fictif, sans compte ni Convex ; RSVP accepté localement (`demo_rsvp_submitted`), `?cinematic=` et `?replay=1` supportés. Indexable, dans le sitemap, testée e2e. |
| 9 | Forfait propagé | Les cartes pricing envoient `/sign-up?plan=essential|premium`. |
| 10 | Poids | `posthog-js` n'est plus chargé que si le visiteur a consenti (ou au clic « Accepter ») : JS de la landing 1 316 → ≈ 1 100 ko non compressé pour un visiteur sans consentement. Le reste est React/Next, Motion, Convex client et Lenis. |

Non livré dans le code, à faire avec les accès fondateur : clés PostHog en Production (2), Search Console et redirection `www` (4), articles réels (11), prospection wedding planners et réseaux (12), test Meta (13), question du nom (14).

## 5. À vérifier côté fondateur (accès requis)

- Vercel → Project → Settings → Environment Variables : présence de `NEXT_PUBLIC_POSTHOG_KEY`, `POSTHOG_KEY`, `POSTHOG_PERSONAL_API_KEY`, `NEXT_PUBLIC_META_PIXEL_ID` en Production.
- PostHog projet 469980 (US) → Activity, puis le dashboard « Funnel Marketing & Conversion » (id 1711205) : combien de `$pageview` depuis le 26 juillet ?
- Vercel → Domains : `www.wedillybird.com` doit être « Redirect to wedillybird.com » (308).
- Stripe : 0 paiement confirmé ? Des sessions checkout abandonnées (signal d'intention) ?
- Produit : que peut faire un couple sans payer (créer l'invitation ? envoyer ?). La copy « sans carte bancaire pour explorer » doit refléter exactement ça.

---

## Annexe — méthode

- Logs : `get_runtime_logs` Vercel groupés par `requestPath` et `statusCode` (prod, 7 j), échantillon détaillé 36 h.
- Web Analytics : appel API → `web_analytics_not_enabled`.
- Build local `next build` sur `main` (f432225), `next start`, mesure Playwright/Chromium des ressources chargées sur `/` et captures 1440×900 / 390×844 (cf. PR).
- Code lu : `app/[locale]/(marketing)/page.tsx`, `components/landing/*`, `lib/analytics/*`, `components/layout/cookie-consent.tsx`, `app/robots.ts`, `app/sitemap.ts`, `messages/fr.json`, `docs/analytics.md`, tunnel `(auth)` / onboarding / `mon-mariage`.
