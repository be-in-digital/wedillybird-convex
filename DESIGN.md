# Wedillybird — Design System

> Source de vérité distillée du code (`app/globals.css`, `app/[locale]/layout.tsx`), à jour 2026-06-03. Doc canonique à fournir aux outils de design (Claude, Stitch, v0, Figma). En cas de conflit, le code prime ; mettre ce fichier à jour ensuite.
>
> Tous les libellés UI sont en **français**. Le produit supporte 7 locales (fr/en/es/it/pt/de/ar) ; **ar = RTL** (layout en miroir).

---

## 1. Essence de marque

Wedillybird = SaaS d'organisation de mariage, WhatsApp-first, pour **couples** (one-shot) et **agences / wedding planners** (abonnement). Marchés : France, Afrique de l'Ouest francophone, Maghreb.

Personnalité : **éditorial, chaleureux, premium, précis**. Référence haute : papeterie de mariage de luxe + magazine de mode italien (Vogue Italia) pour le côté couple ; Linear / Mercury / Arc pour le côté outil pro. Jamais : criard, « SaaS générique bleu », noir pur, blanc pur.

---

## 2. Les deux univers visuels (RÈGLE ABSOLUE)

Le système a **deux thèmes**. Ne jamais les mélanger sur un même écran.

| Univers | Thème | Où | Ambiance |
|---|---|---|---|
| **Mariage éditorial** | **LIGHT** | Landing, auth, onboarding couple, **page d'invitation publique (le WoW)**, RSVP, galerie, pricing, **portail couple marque blanche** | Clair, aéré, chaud, tactile (grain papier), ornements gold, typo Bodoni monumentale |
| **Linear-grade** | **DARK** (`data-theme="dark"`) | Tout le back-office agence : dashboard pro, CRM, rétroplanning, budget, prestataires, équipe, facturation, analytics, gestion par event | Dense, rigoureux, concentré ; charbon brun-violet (jamais noir pur), accents blush + gold |

Le **portail couple marque blanche** = light éditorial, mais reteinté par la couleur de marque de l'agence (multi-tenant, §3.4).

---

## 3. Couleur (OKLCH — « Wedillybird Bloom »)

OKLCH choisi pour une **luminance perceptuelle constante** → contrastes prédictibles, indispensable au branding multi-tenant.

### 3.1 Palette absolue (identique dans les deux thèmes)

**Blush** — primary, rose poudré chaud (Tailwind: `blush-*` / alias `brand-*`)
```
50  oklch(98%   0.012 25)
100 oklch(95%   0.025 22)
200 oklch(91%   0.045 22)
300 oklch(85%   0.06  22)
400 oklch(78%   0.075 22)
500 oklch(72%   0.09  20)
600 oklch(62%   0.095 20)
700 oklch(48%   0.085 22)   ← primary (light)
800 oklch(36%   0.07  24)   ← primary hover (light)
900 oklch(24%   0.05  26)
```

**Champagne** — accent gold subtil (`champagne-*`)
```
50  oklch(98%  0.012 90)
100 oklch(95%  0.022 85)
200 oklch(92%  0.035 80)
300 oklch(88%  0.05  80)
500 oklch(78%  0.075 78)
700 oklch(58%  0.075 80)    ← accent (light)
```

**Ivory** — canvas & surfaces claires (`ivory-*`)
```
50  oklch(98.5% 0.008 85)   = #fbf6ee   ← background light + themeColor mobile
100 oklch(96.5% 0.015 80)
200 oklch(94%   0.022 78)
```

**Sage** — success doux, **jamais** primary (`sage-*`)
```
50  oklch(96% 0.018 145)
300 oklch(82% 0.045 145)
500 oklch(68% 0.08  145)    ← success
700 oklch(50% 0.08  145)
```

**Ink** — texte, charbon brun-rosé chaud, **jamais noir pur** (`ink-*`)
```
300 oklch(58% 0.022 28)
500 oklch(42% 0.022 28)
700 oklch(28% 0.02  28)
900 oklch(18% 0.018 28)     ← foreground light
```

**Gold ornement** — papeterie premium : fleurons ✦, séparateurs, sceaux (`gold-*`)
```
300  oklch(88% 0.05  80)
500  oklch(78% 0.075 78)
700  oklch(58% 0.075 80)
soft oklch(96% 0.022 85)
```

### 3.2 Tokens sémantiques — thème LIGHT
```
background        ivory-50            surface           #ffffff
surface-elevated  ivory-100           surface-warm      blush-50
foreground        ink-900             muted             oklch(60% 0.018 35)
muted-foreground  ink-500             border            oklch(92% 0.012 60)
border-strong     oklch(84% 0.022 50)
primary           blush-700           primary-hover     blush-800
primary-foreground ivory-50           primary-soft      blush-100
accent            champagne-700       accent-soft       champagne-100
success sage-500  warning oklch(75% 0.16 75)  danger oklch(58% 0.19 25)  info oklch(65% 0.11 220)
```

### 3.3 Tokens sémantiques — thème DARK (back-office)
Override sémantique uniquement ; la palette absolue ne change pas.
```
background        oklch(15% 0.012 28)   ← charbon brun-violet, PAS noir
surface           oklch(19% 0.015 28)
surface-elevated  oklch(23% 0.018 28)
surface-warm      oklch(22% 0.03  28)
foreground        oklch(94% 0.012 70)   ← ivoire chaud, PAS blanc pur
muted-foreground  oklch(75% 0.018 65)
border            oklch(28% 0.018 28)   border-strong oklch(38% 0.02 30)
primary           blush-400             primary-hover blush-300   primary-soft oklch(28% 0.06 22)
accent            champagne-300         accent-soft   oklch(28% 0.05 80)
```
success/warning/danger/info : mêmes teintes, lisibles sur fond sombre.

### 3.4 Marque blanche (multi-tenant)
Une agence override **`--brand-500`** (sa couleur). Le serveur **contraint la luminance L ∈ [35 %, 65 %]** pour garantir le contraste AA quelle que soit la teinte. La page publique et le portail couple se reteignent. Toujours prévoir une démo : marque par défaut (blush) **et** une marque custom (ex. teinte verte/bleue).

---

## 4. Typographie

| Rôle | Police | Détails |
|---|---|---|
| **Display** (h1, h2, h3, `.font-display`) | **Bodoni Moda** | Didone variable, weights **400/500/600**, **toujours italic**, `letter-spacing: -0.018em`. Signature éditoriale haute en contraste (ADN Vogue Italia). Fallback : Iowan Old Style Italic, Georgia, serif. |
| **Corps / UI** | **Geist Sans** | `font-feature-settings: 'ss01','cv11'`. Tout le texte courant, labels, boutons, tableaux. |
| **Mono** | **Geist Mono** | Tokens QR, IDs, timestamps, IBAN/numéros de facture. |

Échelle indicative (mobile → desktop, `clamp`) :
- Display XL (hero invitation) : ~clamp(2.75rem, 6vw, 5rem), Bodoni italic
- H1 : clamp(2rem, 4vw, 3rem) · H2 : clamp(1.5rem, 3vw, 2.25rem) · H3 : 1.25–1.5rem
- Corps : 1rem (16px) · Small : 0.875rem · Caption : 0.75rem
Titres = Bodoni italic ; tout le reste = Geist.

---

## 5. Espacement, layout, rayons

**Conteneurs :** `container-page` = max-w-6xl ; `container-wide` = max-w-7xl ; padding `px-5 sm:px-8`, centré.
**Grille :** 4/8px base. Back-office dense (multi-colonnes, tableaux serrés) ; couple/public aéré (beaucoup de blanc/ivoire).

**Rayons :** xs 0.25 · sm 0.375 · md 0.5 · lg 0.75 · xl 1 · 2xl 1.25 · 3xl 1.5 · 4xl 2rem. Cartes premium = 2xl/3xl ; champs/boutons = lg/xl ; pills = full.

---

## 6. Élévation (ombres)
```
soft     0 1px 2px oklch(0% 0 0/4%), 0 4px 12px oklch(48% 0.085 22/6%)     ← cartes au repos
lifted   0 4px 10px oklch(0% 0 0/5%), 0 14px 36px oklch(48% 0.085 22/9%)   ← hover, modals
popover  0 10px 30px oklch(0% 0 0/12%), 0 2px 6px oklch(0% 0 0/6%)         ← menus, popovers
blush    0 20px 60px -15px oklch(72% 0.09 20/35%)                          ← SIGNATURE : halo rosé sur éléments premium
```
En dark, ombres plus marquées (opacités 25–50 %).

---

## 7. Motion

**Easings :** `out-quint cubic-bezier(.22,1,.36,1)` (défaut) · `out-expo cubic-bezier(.16,1,.3,1)` · `spring cubic-bezier(.34,1.56,.64,1)` (entrées ludiques).

**Animations nommées :**
- `fade-in` 320ms · `slide-up` (+12px) 360ms · `scale-in` (.96→1) 220ms
- `float` (±8px, 6s, infinite) · `shimmer` (skeletons de chargement)

**Page d'invitation :** Motion + GSAP — séquences cinématiques (reveal d'enveloppe/sceau, scroll narratif). C'est 50 % de l'effet WoW : viser le spectaculaire.

**Toujours** respecter `prefers-reduced-motion: reduce` (durées ~0, pas de parallax).

---

## 8. Textures & ornements (LIGHT uniquement)
- **`.paper-grain`** : bruit SVG fractal à 5 % en `mix-blend-mode: multiply` → casse le rendu trop « flat » des sections premium, effet tactile. Désactivé en dark.
- **`.ornament-divider`** : séparateur = filet gold dégradé + fleuron ✦ central. Entre sections premium.
- Gold = ornement only (fleurons, sceaux, filets), jamais une grande surface.

---

## 9. Composants (à produire dans les 2 thèmes)

Specs communes : focus ring visible (`ring-2` primary + offset), états hover/active/disabled, transitions out-quint.

- **Boutons** : primary (blush, `shadow-blush` au hover), secondary (bordure), ghost, danger, icon. Rayon lg/xl.
- **Champs** : input, textarea, select, combobox, date/heure, **téléphone international** (WhatsApp), toggle, checkbox, radio, slider. Label FR au-dessus, aide/erreur en dessous.
- **Cartes** : rayon 2xl, `shadow-soft`, hover `shadow-lifted`. Variante premium = `shadow-blush` + `paper-grain` (light).
- **Tableaux denses** (clé back-office dark) : tri, filtres, recherche, pagination, sélection multiple, lignes hover. Mono pour IDs/montants.
- **Status pills / badges** : event (draft / actif / archivé / annulé) ; pipeline CRM (lead / contacté / devis / réservé / en cours / livré) ; paiement (payé / en attente / en retard). Couleurs : sage=ok, warning=attention, danger=retard, muted=neutre.
- **Navigation** : **sidebar dark** (back-office, sections + icônes) ; topbar light (couple) ; breadcrumb ; tabs.
- **Overlays** : modale, **sheet latéral** (édition rapide), dropdown/menu, toast, tooltip, popover.
- **Données** : avatars (+ groupes), **stepper/wizard**, **kanban** (pipeline CRM), **timeline/checklist** (rétroplanning), **mini-charts** (donut budget, barres RSVP, courbe CA), **jauge de quota** (events/messages/stockage, alertes 80 %/100 %), QR code, scanner check-in, sélecteur de devise.
- **Feedback** : empty states illustrés et chaleureux (FR), **skeletons shimmer**, bannières succès/erreur.

---

## 9 bis. Back-office admin — primitives (septembre 2026)

Le super-admin (`/admin`, dark strict) est bâti sur des primitives dédiées. **Toute
nouvelle page admin les réutilise** ; en écrire une variante locale, c'est reproduire
la dérive qu'elles ont corrigée (quinze en-têtes copiés-collés dont les `clamp()`
avaient déjà divergé).

**Base shadcn** (`components/ui/`, `components.json` à la racine) : `table`, `tabs`,
`dropdown-menu`, `separator`, `tooltip`, `sheet`, `scroll-area`, `breadcrumb`,
`popover`, `command`, `checkbox`, `switch`, `progress`, `sidebar` — toutes thémées
sur les tokens OKLCH, donc valables dans les deux univers.

**Primitives admin** (`components/admin/ui/`, import par chemin, pas de barrel) :

| Primitive | Rôle |
|---|---|
| `AdminPage` / `AdminPageHeader` / `AdminSection` | Rythme vertical et échelle typographique uniques. `AdminSection bare` quand le contenu est déjà encadré — jamais de carte dans une carte. |
| `AdminStat` / `AdminStatGrid` | Tuiles KPI à **deux niveaux d'emphase** (`hero`, `default`). Une grille où tout a le même poids ne hiérarchise rien. |
| `AdminDataTable` | Tri, recherche, filtres, pagination, état vide. Sous `md` chaque ligne devient une carte ; le rôle des colonnes s'y déclare via `card`. |
| `AdminCardList` | Même socle pour les collections de **documents** (commande avec adresse postale, signalement avec pile d'erreurs). Un seul rendu. |
| `AdminMeter` / `AdminFunnel` | Jauges et entonnoirs, sur les tokens de statut. |
| `StatusPill` | Pastille de statut : chaque ton porte **aussi une icône** — la couleur seule n'encode jamais un état. |
| `AdminEmptyState` | Distingue « rien à afficher » de « rien ne correspond au filtre ». |

**Navigation** : `components/admin/admin-nav.ts` est la source unique (sidebar, fil
d'Ariane, palette ⌘K). Quinze entrées groupées en cinq intentions — Pilotage, Revenus,
Clients, Croissance, Système. Les liens portent un `aria-label` : le rail replié masque
le libellé visible, le nom accessible doit survivre.

**Formatage** : `lib/admin/format.ts` (montants en unité mineure, dates, ratios,
initiales). `currencyDivisor` y est **la** table des décimales — XOF est zéro-décimale
et TND en millimes, une deuxième copie afficherait un montant faux de deux ordres de
grandeur.

**Typographie du back-office** : Bodoni italic pour le seul `h1` de page ; titres de
section, en-têtes de colonne et micro-libellés en Geist (`0.6875rem`, `tracking-[0.08em]`,
capitales). Le **mono reste réservé** aux identifiants, montants et horodatages.

### Graphes (`components/admin/charts/`)

`chart-theme.ts` porte axes, grille, tooltip et la palette. `SERIES` — rose de marque
`#d55759`, bleu `#2b7ec9`, or `#be8700` — est **validée en toutes paires** sur la surface
dark réelle (`#1a1110`) : bande de luminance, plancher de chroma, séparation daltonienne
et vision normale, contraste ≥ 3:1. La paire or↔rose est en zone WARN daltonienne, donc
utilisable **uniquement** avec encodage secondaire (légende + liseré de 2 px entre aplats).
**Ne pas ajouter de 4ᵉ série sans revalider.**

Règles de forme : grille horizontale seule ; une seule série → pas de légende, le titre
suffit ; deux séries ou plus → `ChartLegend` (HTML, pas `<Legend>` de Recharts, qui dérive
ses pastilles du `stroke` — donc du liseré couleur surface, donc invisibles) ; **pas de
camembert** : une part-de-tout se lit en barres triées (`AdminBreakdown`), et un camembert
à deux parts n'apprend rien qu'une phrase ne dise mieux.

---

## 10. Accessibilité & responsive
- **Contraste AA** garanti (luminance branding contrainte 35–65 %).
- **Focus** toujours visible (focus-ring). Navigation clavier complète. Skip-link présent.
- **RTL (ar)** : layout miroir ; prévoir au moins invitation + dashboard en RTL.
- **Responsive** : **mobile-first** pour invité/RSVP/galerie/check-in (usage téléphone) ; **desktop-dense** pour back-office (utilisable tablette).
- `prefers-reduced-motion` respecté partout.

---

## 11. Voix & copy
- **Français** exclusivement, ton chaleureux mais précis. Côté couple : émotionnel, élégant. Côté agence : efficace, professionnel, dense.
- Montants : format FR (`1 234,56 €`), espaces insécables. Dates en FR.

---

## 12. Do / Don't
**Do** : ink/ivory chauds, Bodoni italic pour les titres, gold en ornement, halo `shadow-blush` sur le premium, dark dense et rigoureux pour le pro, light aéré pour le couple.
**Don't** : noir pur (#000) ou blanc pur (#fff) comme texte/fond ; appeler la marque « terracotta » (alias legacy) ; police display autre que Bodoni Moda Italic ; mélanger light et dark sur un même écran ; gold en aplat large ; animations sans fallback reduced-motion.
