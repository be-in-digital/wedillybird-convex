/**
 * Entitlements & quotas Pro — **source de vérité applicative** des limites par
 * forfait agence, alignée sur `.context/livrables-wedillybird/Grille-Tarifaire-Pro-v3.md`
 * (validée) et le CLAUDE.md projet.
 *
 * Deux familles de limites :
 *
 *  1. **Quotas chiffrés** (events / invités / messages / stockage / sièges) —
 *     surfacés dans le cockpit (jauges) et la facturation. Certains sont
 *     « durs » (sièges : on bloque l'invitation au-delà), d'autres « souples »
 *     facturés en dépassement (messages 0,06 €, invités 0,25 €, stockage
 *     0,03 €/Go/mois, event simultané 19 €/mois).
 *  2. **Gating de fonctionnalités** (CRM pipeline, budget éditable, intégrations,
 *     analytics multi-events, marque blanche totale…) — réservées à un palier.
 *
 * Volontairement **app-side** et pur (le bundler Convex ne suit pas ces imports ;
 * la règle minimale de gating *par event* vit séparément dans
 * `convex/lib/entitlements.ts`). Garder les deux cohérents.
 */

import type { SubscriptionTier } from './subscriptions';

/** Octets par Go (décimal, cohérent avec l'affichage marketing « Go »). */
export const BYTES_PER_GO = 1_000_000_000;

export interface ProTierLimits {
  /** Events actifs simultanés inclus dans le forfait. */
  activeEvents: number;
  /** Cap invités par event (au-delà : dépassement 0,25 €/invité). */
  guestsPerEvent: number;
  /** Stockage inclus, en **octets** (au-delà : 0,03 €/Go/mois). */
  storageBytes: number;
  /** Messages WhatsApp/SMS inclus par mois (au-delà : 0,06 €/message). */
  whatsappMessagesPerMonth: number;
  /** Sièges équipe inclus. `null` = illimité (Agency). */
  seats: number | null;
  /** Fiches annuaire prestataires. `null` = illimité (Business+). */
  vendorDirectoryCap: number | null;
}

/** Grille v3 — capacités par tier (garde-fous marge ; le tiering se vend sur la profondeur back-office). */
export const PRO_TIER_LIMITS: Record<SubscriptionTier, ProTierLimits> = {
  starter: {
    activeEvents: 5,
    guestsPerEvent: 150,
    storageBytes: 50 * BYTES_PER_GO,
    whatsappMessagesPerMonth: 3000,
    seats: 2,
    vendorDirectoryCap: 25,
  },
  business: {
    activeEvents: 20,
    guestsPerEvent: 150,
    storageBytes: 200 * BYTES_PER_GO,
    whatsappMessagesPerMonth: 10000,
    seats: 8,
    vendorDirectoryCap: null,
  },
  agency: {
    activeEvents: 50,
    guestsPerEvent: 150,
    storageBytes: 500 * BYTES_PER_GO,
    whatsappMessagesPerMonth: 25000,
    seats: null,
    vendorDirectoryCap: null,
  },
};

/** Tarifs de dépassement (en centimes d'euro), pour affichage et facturation. */
export const PRO_OVERAGE_EUR_MINOR = {
  /** Par message WhatsApp/SMS au-delà du bundle mensuel. */
  whatsappMessage: 6,
  /** Par invité au-delà du cap de 150/event. */
  guest: 25,
  /** Par Go/mois de stockage au-delà du quota. */
  storageGoPerMonth: 3,
  /** Par event simultané au-delà du quota du tier (prorata). */
  extraEventPerMonth: 1900,
  /** Par siège supplémentaire (Starter/Business uniquement). */
  extraSeatPerMonth: 1900,
} as const;

/* -------------------------------------------------------------------------- */
/*  Gating de fonctionnalités par palier                                       */
/* -------------------------------------------------------------------------- */

export type ProFeature =
  /** CRM clients : pipeline kanban + table dense + conversion lead→mariage. */
  | 'crmPipeline'
  /** Budget mariage éditable (Starter = lecture/suivi seulement). */
  | 'budgetEditing'
  /** Devis / factures / contrats e-sign. */
  | 'documentsEsign'
  /** Rattachement prestataire→mariage + création auto de ligne budget. */
  | 'vendorAttach'
  /** Portail couple marque blanche (espace mariés OTP). */
  | 'couplePortal'
  /** Intégrations CRM live (HoneyBook / Zapier / API) + mode « propre CRM ». */
  | 'integrations'
  /** Analytics multi-events consolidé. */
  | 'analyticsMulti'
  /** Marque blanche totale (domaine custom + emails + retrait du badge). */
  | 'whiteLabelTotal';

const TIER_RANK: Record<SubscriptionTier, number> = { starter: 0, business: 1, agency: 2 };

/** Palier minimum requis pour chaque fonctionnalité (grille v3). */
export const FEATURE_MIN_TIER: Record<ProFeature, SubscriptionTier> = {
  crmPipeline: 'business',
  budgetEditing: 'business',
  documentsEsign: 'business',
  vendorAttach: 'business',
  couplePortal: 'business',
  integrations: 'agency',
  analyticsMulti: 'agency',
  whiteLabelTotal: 'agency',
};

/** Le tier donne-t-il accès à la fonctionnalité ? (un tier supérieur hérite). */
export function tierHasFeature(
  tier: SubscriptionTier | null | undefined,
  feature: ProFeature,
): boolean {
  if (!tier) return false;
  return TIER_RANK[tier] >= TIER_RANK[FEATURE_MIN_TIER[feature]];
}

/** Le tier `a` est-il ≥ au tier `b` ? (utile pour comparer des paliers). */
export function tierAtLeast(a: SubscriptionTier | null | undefined, b: SubscriptionTier): boolean {
  if (!a) return false;
  return TIER_RANK[a] >= TIER_RANK[b];
}

/**
 * Miroir app-side de `convex/lib/entitlements.ts:eventHasFeature`, restreint aux
 * features **Premium-only** (dont `customRsvpQuestions`). Sert à afficher /
 * masquer l'upsell ; la mutation Convex reste l'autorité (`FEATURE_LOCKED`).
 * Précédence planTier > organizationId : Premium → oui, Essentiel → non, event
 * Pro (rattaché à une orga, sans planTier) → oui, sinon non.
 */
export function eventHasPremiumOnlyFeature(event: {
  planTier?: 'essential' | 'premium' | null;
  organizationId?: string | null;
}): boolean {
  if (event.planTier === 'premium') return true;
  if (event.planTier === 'essential') return false;
  if (event.organizationId) return true;
  return false;
}

/* -------------------------------------------------------------------------- */
/*  Accès back-office : l'agence a-t-elle choisi un forfait ?                   */
/* -------------------------------------------------------------------------- */

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid';

/** État d'abonnement minimal d'une organisation (côté UI). */
export interface OrgAccessState {
  subscriptionStatus?: SubscriptionStatus | null;
  paygCredits?: number | null;
  /** Compte offert (partenariat, démo) — actif tant que `expiresAt` est devant. */
  compedSubscription?: { expiresAt: number } | null;
}

/**
 * L'organisation a-t-elle **choisi un forfait** et donc accès aux
 * fonctionnalités du back-office (créer un mariage, rétroplanning, prestataires…) ?
 *
 * `true` si abonnement `active`/`trialing`, OU **compte offert non expiré**, OU
 * crédits Pay-as-you-go > 0 (au moins un événement payé). `false` pour une
 * agence fraîchement onboardée (rien choisi) ou un abonnement
 * `past_due`/`canceled`/`unpaid` sans crédit PAYG.
 *
 * La branche « compte offert » est datée : un cadeau n'a aucun abonnement
 * Stripe derrière, donc rien ne viendrait le clore à l'échéance. C'est la
 * lecture d'`expiresAt` à chaque appel qui fait que « six mois » veut dire six
 * mois.
 *
 * **Miroir exact** de `convex/lib/entitlements.ts:orgHasActiveAccess` (le
 * garde-fou serveur qui fait foi) — garder les deux en phase, y compris la
 * comparaison de date. Le bundler Convex ne suivant pas les imports de `lib/`,
 * la duplication est assumée ; un test croise les deux implémentations. Sert à
 * afficher la bannière « choisir un forfait » et à masquer les actions de
 * création.
 */
export function orgHasActiveAccess(
  org: OrgAccessState | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!org) return false;
  if (org.subscriptionStatus === 'active' || org.subscriptionStatus === 'trialing') return true;
  if (org.compedSubscription && org.compedSubscription.expiresAt > now) return true;
  return (org.paygCredits ?? 0) > 0;
}

/**
 * Palier **effectif** d'une organisation : son tier tant que sa couverture
 * court, `null` dès qu'elle est éteinte.
 *
 * `subscriptionTier` est une colonne *persistante* : elle reste écrite sur
 * l'organisation quand l'abonnement est résilié comme quand un compte offert
 * expire — c'est voulu, la facturation et l'historique en ont besoin. Mais les
 * écrans de fonctionnalités ne lisaient QUE cette colonne
 * (`tierHasFeature(org.subscriptionTier, …)`), sans demander si la couverture
 * existait encore. Une agence dont le cadeau a expiré gardait donc CRM, budget
 * éditable, devis, contrats, encaissements, analytics et intégrations ouverts
 * — gratuitement et sans fin, pendant que son tableau de bord lui réclamait un
 * forfait. Inoffensif tant que le cadeau valait Starter (qui n'ouvre aucune de
 * ces sept entrées) ; une fuite dès qu'il vaut Agency.
 *
 * C'est donc CE palier-ci que doivent lire les gates de fonctionnalités et les
 * cadenas de la sidebar. La page de facturation, elle, continue de lire le tier
 * brut : elle doit montrer le forfait qu'on a eu, même éteint.
 */
export function effectiveProTier(
  org: (OrgAccessState & { subscriptionTier?: SubscriptionTier | null }) | null | undefined,
  now: number = Date.now(),
): SubscriptionTier | null {
  if (!orgHasActiveAccess(org, now)) return null;
  return org?.subscriptionTier ?? null;
}

/* -------------------------------------------------------------------------- */
/*  Bandeau d'abonnement du cockpit agence                                     */
/* -------------------------------------------------------------------------- */

/** Bandeau à afficher en tête du cockpit — `'none'` = aucun. */
export type ProSubscriptionBanner = 'none' | 'no_plan' | 'payment_failed' | 'cancelled';

/**
 * Quel bandeau d'abonnement le cockpit agence doit-il afficher ?
 *
 * Le bandeau « Aucun abonnement actif — choisissez un forfait pour débloquer le
 * back-office » se lisait sur le seul couple (tier, statut Stripe). Or un
 * **compte offert** n'a par construction aucun objet Stripe derrière
 * (cf. `convex/lib/partnerInvite.ts`) : une partenaire à qui l'on venait
 * d'ouvrir six mois lisait donc, sous son propre décompte, qu'elle n'avait rien
 * choisi et que son back-office était verrouillé — alors que le serveur la
 * laissait entrer. Même faux mur pour une agence Pay-as-you-go, qui a payé au
 * moins un événement.
 *
 * La règle est donc celle de l'accès réel (`orgHasActiveAccess`, le garde-fou
 * serveur) : on ne réclame un forfait que si le back-office est effectivement
 * verrouillé. Un incident de paiement (`past_due`/`unpaid`) ou une résiliation
 * restent en revanche annoncés tels quels — ce sont des faits Stripe, pas un
 * défaut d'accès.
 */
export function proSubscriptionBanner(
  org: (OrgAccessState & { subscriptionTier?: SubscriptionTier | null }) | null | undefined,
  now: number = Date.now(),
): ProSubscriptionBanner {
  const tier = org?.subscriptionTier ?? null;
  const status = org?.subscriptionStatus ?? null;
  if (tier && (status === 'active' || status === 'trialing')) return 'none';
  if (!tier || !status) {
    return orgHasActiveAccess(org, now) ? 'none' : 'no_plan';
  }
  if (status === 'past_due' || status === 'unpaid') return 'payment_failed';
  return 'cancelled';
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
 *
 * ⚠️ Miroir de `convex/lib/entitlements.ts:galleryAccessFor`.
 */
export function galleryAccessFor(
  event: { organizationId?: unknown; galleryExpiresAt?: number | null },
  org: OrgAccessState | null | undefined,
  now: number = Date.now(),
): GalleryAccess {
  if (event.organizationId) {
    return orgHasActiveAccess(org, now) ? 'open' : 'expired';
  }
  if (event.galleryExpiresAt == null) return 'locked';
  return now > event.galleryExpiresAt ? 'expired' : 'open';
}

/* -------------------------------------------------------------------------- */
/*  Quotas : statut d'usage (pur)                                              */
/* -------------------------------------------------------------------------- */

/**
 * Faut-il proposer un **forfait particulier** (Essentiel / Premium) sur cet
 * événement ?
 *
 * Non dès qu'il appartient à une organisation : un mariage porté par une
 * agence est couvert par l'abonnement de celle-ci — ou par son compte offert,
 * ou par un crédit PAYG. C'est exactement ce que dit `decidePublishGate`, qui
 * ne réclame jamais de `planTier` à un event porteur d'`organizationId`.
 *
 * L'afficher quand même faisait dire à l'écran l'inverse de ce que fait le
 * serveur : une partenaire à qui l'on vient d'offrir six mois créait son
 * premier mariage et se voyait proposer de payer 29 € ou 59 €. Rien ne
 * bloquait — la publication passait — mais le doute suffit à faire abandonner.
 */
export function eventNeedsConsumerPlan(event: {
  organizationId?: string | null;
  planTier?: string | null;
}): boolean {
  if (event.organizationId) return false;
  return true;
}

export type QuotaLevel = 'ok' | 'warning' | 'danger';

export interface QuotaStatus {
  used: number;
  /** Quota inclus, ou `null` si illimité. */
  included: number | null;
  /** Restant avant dépassement, ou `null` si illimité. */
  remaining: number | null;
  /** Ratio usage/inclus (0 si illimité, ≥1 = dépassement). */
  ratio: number;
  /** Quantité consommée au-delà de l'inclus (0 si dans les clous / illimité). */
  overage: number;
  level: QuotaLevel;
  unlimited: boolean;
}

/** Seuil d'alerte (warning) — aligné sur le design (marqueur 80 %). */
export const QUOTA_WARNING_RATIO = 0.8;

/**
 * Calcule le statut d'un quota. `included = null` → illimité (jamais en alerte).
 */
export function quotaStatus(used: number, included: number | null): QuotaStatus {
  const safeUsed = Number.isFinite(used) && used > 0 ? used : 0;
  if (included === null) {
    return {
      used: safeUsed,
      included: null,
      remaining: null,
      ratio: 0,
      overage: 0,
      level: 'ok',
      unlimited: true,
    };
  }
  const ratio = included <= 0 ? (safeUsed > 0 ? Number.POSITIVE_INFINITY : 0) : safeUsed / included;
  const overage = Math.max(0, safeUsed - included);
  const level: QuotaLevel = ratio >= 1 ? 'danger' : ratio >= QUOTA_WARNING_RATIO ? 'warning' : 'ok';
  return {
    used: safeUsed,
    included,
    remaining: Math.max(0, included - safeUsed),
    ratio,
    overage,
    level,
    unlimited: false,
  };
}

/** Usage agrégé d'une organisation (calculé côté Convex). */
export interface ProUsage {
  activeEvents: number;
  storageBytes: number;
  whatsappMessagesThisMonth: number;
  seatsUsed: number;
}

export interface ProQuotaGauges {
  events: QuotaStatus;
  storage: QuotaStatus;
  messages: QuotaStatus;
  seats: QuotaStatus;
}

/** Construit les 4 jauges de quota du cockpit/facturation depuis tier + usage. */
export function buildQuotaGauges(tier: SubscriptionTier, usage: ProUsage): ProQuotaGauges {
  const limits = PRO_TIER_LIMITS[tier];
  return {
    events: quotaStatus(usage.activeEvents, limits.activeEvents),
    storage: quotaStatus(usage.storageBytes, limits.storageBytes),
    messages: quotaStatus(usage.whatsappMessagesThisMonth, limits.whatsappMessagesPerMonth),
    seats: quotaStatus(usage.seatsUsed, limits.seats),
  };
}

/**
 * Un siège supplémentaire peut-il être ajouté ? (invitation d'équipe).
 * Agency (sièges illimités) → toujours `true`.
 */
export function canAddSeat(tier: SubscriptionTier, seatsUsed: number): boolean {
  const { seats } = PRO_TIER_LIMITS[tier];
  if (seats === null) return true;
  return seatsUsed < seats;
}

/**
 * Une fiche prestataire peut-elle être ajoutée ? Starter est plafonné à 25 ;
 * Business/Agency illimité.
 */
export function canAddVendor(tier: SubscriptionTier, count: number): boolean {
  const cap = PRO_TIER_LIMITS[tier].vendorDirectoryCap;
  if (cap === null) return true;
  return count < cap;
}
