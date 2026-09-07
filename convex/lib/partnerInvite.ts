/**
 * Invitation partenaire — un lien qui ouvre un compte agence offert.
 *
 * Une créatrice qu'on recrute comme partenaire doit pouvoir essayer le produit
 * pour de vrai avant de le recommander. Or le back-office pro est verrouillé
 * tant que l'agence n'a pas d'abonnement (`orgHasActiveAccess`) : elle
 * s'inscrirait, nommerait son agence, et se heurterait immédiatement à un mur.
 * Ce lien lève ce mur pour elle, et pour elle seule.
 *
 * ## Pourquoi aucun abonnement Stripe
 *
 * Le cadeau ne crée AUCUN objet Stripe. Un essai Stripe se termine en tentant
 * de prélever : le jour de l'échéance, une partenaire qu'on courtise recevrait
 * un échec de paiement puis une relance de recouvrement. Ici le cadeau expire
 * en silence et l'espace pro affiche un décompte vers le checkout normal.
 * Conséquence assumée : pas de conversion automatique — elle devra souscrire
 * activement, ce qui est exactement ce qu'on veut d'un partenaire.
 *
 * ## Pourquoi le tier est écrit sur l'organisation
 *
 * `eventQuotaForTier(undefined)` rend `null`, c'est-à-dire **illimité**. Une
 * organisation à qui l'on ouvrirait l'accès sans lui poser de tier aurait donc
 * des mariages sans plafond — l'inverse d'un compte d'essai. Le cadeau écrit
 * `subscriptionTier` (Starter par défaut : assez pour un vrai test, trop peu
 * pour exploiter une agence gratuitement) et laisse `subscriptionStatus` à
 * Stripe. Cette séparation est ce qui garantit qu'un cadeau ne sera jamais
 * compté comme du revenu : le MRR se calcule sur le statut, pas sur le tier.
 */

/** Tier offert par défaut — cf. plafond commercial ci-dessus. */
export const DEFAULT_PARTNER_COMP_TIER = 'starter' as const;

/** Durée du compte offert, en mois calendaires. */
export const DEFAULT_PARTNER_COMP_MONTHS = 6;

/**
 * Validité du LIEN, distincte de la durée du compte. Un lien qui offre six
 * mois est un lien qui offre six mois à quiconque l'ouvre : s'il est transféré
 * ou publié dans la communauté du partenaire, il distribue des comptes agence.
 * Il est donc à usage unique ET périmé s'il n'est pas utilisé rapidement.
 */
export const PARTNER_INVITE_VALIDITY_DAYS = 30;

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type CompTier = 'starter' | 'business' | 'agency';

export interface CompedSubscription {
  tier: CompTier;
  grantedAt: number;
  expiresAt: number;
}

/**
 * Ajoute des mois **calendaires** à un instant, en UTC. Un « 6 mois » posé en
 * jours (180) dériverait selon le mois de départ ; une partenaire à qui l'on
 * a promis six mois compte en mois, pas en jours. Le jour du mois est ramené
 * au dernier jour valide quand la cible est plus courte (31 août + 6 mois →
 * 28 ou 29 février).
 */
export function addMonthsUtc(from: number, months: number): number {
  const start = new Date(from);
  const day = start.getUTCDate();
  const target = new Date(
    Date.UTC(
      start.getUTCFullYear(),
      start.getUTCMonth() + months,
      1,
      start.getUTCHours(),
      start.getUTCMinutes(),
      start.getUTCSeconds(),
      start.getUTCMilliseconds(),
    ),
  );
  const lastDayOfTargetMonth = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDayOfTargetMonth));
  return target.getTime();
}

/** Échéance d'un cadeau accordé à `grantedAt` pour `months` mois. */
export function compExpiresAt(grantedAt: number, months = DEFAULT_PARTNER_COMP_MONTHS): number {
  return addMonthsUtc(grantedAt, months);
}

/** Échéance du LIEN lui-même (délai pour l'utiliser). */
export function inviteExpiresAt(createdAt: number, days = PARTNER_INVITE_VALIDITY_DAYS): number {
  return createdAt + days * MS_PER_DAY;
}

/**
 * Le cadeau est-il encore en cours ? C'est cette fonction qui fait que « six
 * mois » veut dire six mois : sans elle, un cadeau posé une fois ne
 * s'éteindrait jamais, faute d'abonnement Stripe pour le clore.
 */
export function isCompActive(
  comp: { expiresAt: number } | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!comp) return false;
  return comp.expiresAt > now;
}

/**
 * Jours entiers restants, arrondis vers le haut — « il reste 1 jour » tant
 * qu'il reste quelques heures, jamais « 0 jour » sur un compte encore ouvert.
 */
export function compDaysRemaining(
  comp: { expiresAt: number } | null | undefined,
  now: number = Date.now(),
): number {
  if (!comp) return 0;
  const remaining = comp.expiresAt - now;
  if (remaining <= 0) return 0;
  return Math.ceil(remaining / MS_PER_DAY);
}

export type InviteState = 'usable' | 'consumed' | 'revoked' | 'expired';

/** État d'un lien, dans l'ordre où les raisons priment l'une sur l'autre. */
export function inviteState(
  invite: { consumedAt?: number | null; revokedAt?: number | null; expiresAt: number },
  now: number = Date.now(),
): InviteState {
  if (invite.consumedAt) return 'consumed';
  if (invite.revokedAt) return 'revoked';
  if (invite.expiresAt <= now) return 'expired';
  return 'usable';
}

/* ==================== Ouverture du cadeau hors lien d'invitation ==================== */

/**
 * Un compte partenaire ne doit jamais avoir à choisir un forfait ni à payer :
 * le cadeau six mois est la contrepartie du partenariat. Or il n'était posé
 * que par la redemption d'un lien d'invitation. Une partenaire rattachée
 * depuis l'admin restait donc en rôle `couple`, sans organisation ni cadeau —
 * et l'assistant de création d'événement lui présentait l'étape « choisir le
 * forfait », puis le mur du paiement à la publication.
 *
 * Cette décision est partagée par les deux chemins d'ouverture (lien et
 * rattachement admin) pour qu'ils ne puissent pas diverger.
 */
export type PartnerCompDecision =
  | { action: 'grant' }
  | { action: 'skip'; reason: 'already_comped' }
  | { action: 'refuse'; reason: 'org_subscribed' };

export interface PartnerCompOrgState {
  /** Abonnement Stripe réel — sa présence signe une organisation cliente. */
  stripeSubscriptionId?: string;
  compedSubscription?: { expiresAt: number };
}

/**
 * Faut-il ouvrir (ou ré-ouvrir) le compte offert de cette organisation ?
 *
 *  - **Refus** si elle est déjà cliente : lui poser un cadeau la sortirait du
 *    MRR alors qu'elle paie. Ce cas se règle à la main, jamais automatiquement.
 *  - **Skip** si un cadeau court encore : re-rattacher un affilié ne doit pas
 *    prolonger les six mois en silence, sinon le cadeau devient perpétuel.
 *  - **Grant** sinon — y compris quand un ancien cadeau a expiré, ce qui est
 *    un renouvellement explicite décidé par l'admin qui rattache.
 */
export function decidePartnerComp(input: {
  org?: PartnerCompOrgState | null;
  now: number;
}): PartnerCompDecision {
  const org = input.org;
  if (org?.stripeSubscriptionId) return { action: 'refuse', reason: 'org_subscribed' };
  if (org?.compedSubscription && org.compedSubscription.expiresAt > input.now) {
    return { action: 'skip', reason: 'already_comped' };
  }
  return { action: 'grant' };
}
