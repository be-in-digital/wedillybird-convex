/**
 * Entitlements par formule — quelles features « gated » sont accessibles selon
 * le tier de l'event.
 *
 * Règle (miroir de `lib/payments/plans.ts:PREMIUM_EXTRA_FEATURES`) : ces features
 * sont réservées à **Premium** côté particuliers — **Essentiel ne les a pas**.
 * Les events **Pro** (rattachés à une orga abonnée) embarquent l'intégralité des
 * features Premium par event (« Tout Premium inclus »).
 *
 * Volontairement **convex-local** (pas d'import `lib/payments`) : le bundler
 * Convex ne suit pas les imports app-side. On duplique la règle ici — garder en
 * phase avec `PREMIUM_EXTRA_FEATURES`.
 */

import { isCompActive } from './partnerInvite';

export type GatedFeature =
  | 'faceSearch'
  | 'galleryZipDownload'
  | 'pdfAlbumFinal'
  | 'cinematicInvitation'
  | 'seatingPlan'
  | 'customRsvpQuestions';

/** Features Premium-only (absentes d'Essentiel). */
const PREMIUM_ONLY: ReadonlySet<GatedFeature> = new Set<GatedFeature>([
  'faceSearch',
  'galleryZipDownload',
  'pdfAlbumFinal',
  'cinematicInvitation',
  'seatingPlan',
  'customRsvpQuestions',
]);

/**
 * Un event a-t-il accès à une feature gated ?
 *
 * Précédence `planTier` > `organizationId` (cohérent avec `decidePublishGate` :
 * le plan particulier prime). Un event pur Pro (planTier absent, orga présente)
 * a toutes les features Premium. Un event ni payé ni rattaché → aucune.
 */
export function eventHasFeature(
  event: { planTier?: 'essential' | 'premium'; organizationId?: unknown },
  feature: GatedFeature,
): boolean {
  if (event.planTier === 'premium') return true;
  if (event.planTier === 'essential') return !PREMIUM_ONLY.has(feature);
  if (event.organizationId) return true; // event pro → toutes les features Premium
  return false; // event non payé (ni plan ni orga)
}

/**
 * Quota d'events actifs simultanés par tier Pro (grille v2 : 5/20/50).
 * `null` = pas de tier connu → aucun quota appliqué côté publish gate.
 */
export function eventQuotaForTier(
  tier: 'starter' | 'business' | 'agency' | undefined,
): number | null {
  switch (tier) {
    case 'starter':
      return 5;
    case 'business':
      return 20;
    case 'agency':
      return 50;
    default:
      return null;
  }
}

/**
 * Sièges équipe inclus par tier Pro (grille v3 : 2 / 8 / illimité).
 * `null` = illimité (Agency). Sans abonnement, on applique le plancher Starter
 * (2 sièges) — un garde-fou raisonnable plutôt qu'illimité.
 *
 * Miroir de `lib/payments/entitlements.ts:PRO_TIER_LIMITS[...].seats` — garder
 * en phase (le bundler Convex ne suit pas les imports app-side).
 */
export function seatLimitForTier(
  tier: 'starter' | 'business' | 'agency' | undefined,
): number | null {
  switch (tier) {
    case 'business':
      return 8;
    case 'agency':
      return null;
    case 'starter':
    default:
      return 2;
  }
}

const PRO_TIER_RANK: Record<'starter' | 'business' | 'agency', number> = {
  starter: 0,
  business: 1,
  agency: 2,
};

/**
 * Le tier Pro de l'organisation atteint-il au moins `min` ? Utilisé pour gater
 * les modules réservés à un palier (CRM/budget édition = business+, intégrations
 * /analytics = agency). Miroir convex-local de `lib/payments/entitlements.ts`.
 */
export function proTierAtLeast(
  tier: 'starter' | 'business' | 'agency' | undefined,
  min: 'starter' | 'business' | 'agency',
): boolean {
  if (!tier) return false;
  return PRO_TIER_RANK[tier] >= PRO_TIER_RANK[min];
}

/**
 * Plafond de l'annuaire prestataires (grille v3 : Starter ≤ 25, Business/Agency
 * illimité). `null` = illimité. Sans abonnement → plancher Starter (25).
 */
export function vendorCapForTier(
  tier: 'starter' | 'business' | 'agency' | undefined,
): number | null {
  return tier === 'business' || tier === 'agency' ? null : 25;
}

/**
 * État d'abonnement minimal d'une organisation, suffisant pour décider de
 * l'accès aux fonctionnalités du back-office.
 */
export type OrgSubscriptionState = {
  subscriptionStatus?: 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid';
  paygCredits?: number;
  /** Compte offert (partenariat, démo) — actif tant que `expiresAt` est devant. */
  compedSubscription?: { expiresAt: number } | null;
};

/**
 * L'organisation a-t-elle **choisi un forfait** et donc accès aux
 * fonctionnalités du back-office (créer un mariage, rétroplanning, prestataires…) ?
 *
 * `true` si : abonnement `active` ou `trialing`, OU **compte offert non
 * expiré**, OU crédits Pay-as-you-go > 0 (l'agence a payé au moins un
 * événement). `false` sinon — notamment une agence fraîchement onboardée qui
 * n'a encore rien choisi (aucun statut, 0 crédit), ou dont l'abonnement est
 * `past_due`/`canceled`/`unpaid` sans crédit PAYG.
 *
 * La branche « compte offert » est datée à dessein. Un cadeau n'a **aucun**
 * abonnement Stripe derrière : personne ne viendrait clore quoi que ce soit à
 * l'échéance. Poser un statut `trialing` aurait donc ouvert l'accès à vie —
 * c'est en lisant `expiresAt` à chaque appel que la durée offerte veut dire
 * mois. Un cadeau expiré ne bloque en revanche jamais une agence qui a
 * réellement souscrit depuis : le statut Stripe est testé en premier.
 *
 * Aligné sur `decidePublishGate` (convex/events.ts) : mêmes statuts « actifs »
 * (active/trialing) + repli PAYG. Le back-office est donc verrouillé tant que
 * l'agence n'a pas d'abonnement, de cadeau en cours ou de crédit. Miroir
 * app-side : `lib/payments/entitlements.ts:orgHasActiveAccess`.
 */
export function orgHasActiveAccess(
  org: OrgSubscriptionState | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!org) return false;
  if (org.subscriptionStatus === 'active' || org.subscriptionStatus === 'trialing') return true;
  if (isCompActive(org.compedSubscription, now)) return true;
  return (org.paygCredits ?? 0) > 0;
}

/** État d'accès d'une galerie, du point de vue de l'écran comme du serveur. */
export type GalleryAccess = 'open' | 'locked' | 'expired';

/**
 * La galerie d'un événement est-elle ouverte ?
 *
 * Deux régimes, parce que les deux modèles économiques ne se ressemblent pas :
 *
 *  - **Particulier** : la rétention est *achetée*. Une date figée sur l'event
 *    (`galleryExpiresAt`, posée au paiement, repoussée par l'upsell HD) suffit,
 *    et l'absence de date signifie « pas encore payé » → `locked`.
 *  - **Agence** : la galerie vit aussi longtemps que la **couverture de
 *    l'organisation**. Elle ne peut donc pas être figée : écrire
 *    `galleryExpiresAt = fin de période` à la création fermerait la galerie à
 *    la fin du mois en cours alors que l'agence continue de payer, et un
 *    renouvellement n'irait jamais rouvrir les events déjà créés. On évalue à
 *    la lecture, contre l'état courant de l'organisation.
 *
 * Un mariage d'agence sans couverture est `expired`, pas `locked` : il n'y a
 * pas de forfait à acheter pour cet événement-là, il y a un abonnement à
 * reprendre — et le message doit envoyer vers la facturation agence, pas vers
 * les forfaits particuliers.
 */
export function galleryAccessFor(
  event: { organizationId?: unknown; galleryExpiresAt?: number | null },
  org: OrgSubscriptionState | null | undefined,
  now: number = Date.now(),
): GalleryAccess {
  if (event.organizationId) {
    return orgHasActiveAccess(org, now) ? 'open' : 'expired';
  }
  if (event.galleryExpiresAt == null) return 'locked';
  return now > event.galleryExpiresAt ? 'expired' : 'open';
}
