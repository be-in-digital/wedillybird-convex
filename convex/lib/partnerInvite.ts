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
 * `subscriptionTier` et laisse `subscriptionStatus` à Stripe. Cette séparation
 * est ce qui garantit qu'un cadeau ne sera jamais compté comme du revenu : le
 * MRR se calcule sur le statut, pas sur le tier.
 *
 * ## Pourquoi le tier le plus haut
 *
 * Le cadeau était plafonné à Starter — assez pour tester, trop peu pour
 * exploiter une agence gratuitement. Mais Starter verrouille six entrées de la
 * sidebar (CRM clients, budget éditable, devis/factures, contrats, analytics
 * multi-events, intégrations) : une partenaire qu'on courtise pour qu'elle
 * recommande le produit n'en voyait que la moitié, cadenassée. On offre donc le
 * palier complet, exactement comme le Premium offert à un lien `couple`. Le
 * garde-fou n'est plus le tier mais la DURÉE : le cadeau expire seul, et
 * `isCompActive` referme tout à l'échéance.
 */

import { DEFAULT_COMPED_EVENT_PLAN } from './eventPlan';

/** Tier offert par défaut — le palier complet, cf. justification ci-dessus. */
export const DEFAULT_PARTNER_COMP_TIER = 'agency' as const;

/**
 * Type de compte ouvert par un lien d'invitation.
 *
 * Les deux existent parce que les deux partenariats existent : une agence qui
 * gère des mariages, et une personne dont c'est le propre mariage — une
 * créatrice, une amie de la marque. Ce qu'on leur offre n'a pas la même forme,
 * parce que leurs modèles économiques n'ont pas la même forme.
 */
export type PartnerInviteKind = 'pro' | 'couple';

/** Défaut historique : les liens créés avant ce champ n'ouvraient que du pro. */
export function inviteKind(invite: { kind?: PartnerInviteKind | null }): PartnerInviteKind {
  return invite.kind ?? 'pro';
}

/**
 * Forfait particulier offert par défaut.
 *
 * Premium, et non Essentiel : le cadeau doit valoir quelque chose. C'est aussi
 * le seul qui inclut la galerie partagée, donc le seul qui montre le produit
 * en entier à quelqu'un qu'on veut voir en parler.
 *
 * Alias de `DEFAULT_COMPED_EVENT_PLAN` : le lien partenaire et l'octroi
 * commercial (`admin:grantEventPlan`) offrent le MÊME forfait, et deux
 * littéraux pour une seule règle produit dérivent en silence — l'un des deux
 * offrirait un jour l'Essentiel sans que personne le décide.
 */
export const DEFAULT_PARTNER_COMP_EVENT_TIER = DEFAULT_COMPED_EVENT_PLAN;

/**
 * Durée du compte agence offert, en mois calendaires.
 *
 * Douze mois, et non six : une agence se juge sur une **saison de mariages
 * entière**. Six mois lui font traverser la moitié d'un cycle — elle
 * découvrirait l'échéance en pleine haute saison, au moment où elle a le moins
 * de temps pour arbitrer un abonnement.
 *
 * Cette valeur ne s'applique qu'aux liens **créés après** sa modification :
 * `grantMonths` est figé sur chaque invitation à sa création, pour que ce qui
 * a été promis reste ce qui est livré.
 */
export const DEFAULT_PARTNER_COMP_MONTHS = 12;

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

/**
 * Haute saison des mariages, en mois UTC 0-indexés : mai à septembre inclus.
 *
 * C'est la fenêtre où une agence enchaîne les événements — et donc la pire
 * pour lui demander quoi que ce soit.
 */
const HIGH_SEASON_FIRST_MONTH = 4; // mai
const HIGH_SEASON_LAST_MONTH = 8; // septembre

/**
 * Mois d'atterrissage hors saison : janvier. Le cadeau expire le dernier jour
 * de ce mois, quand une planneuse arbitre réellement ses outils pour la saison
 * qui vient.
 */
const OFF_SEASON_LANDING_MONTH = 0; // janvier

/** Le jour tombe-t-il en pleine haute saison ? */
export function isHighSeason(at: number): boolean {
  const month = new Date(at).getUTCMonth();
  return month >= HIGH_SEASON_FIRST_MONTH && month <= HIGH_SEASON_LAST_MONTH;
}

/**
 * Dernier instant du mois d'atterrissage qui suit `at` — 31 janvier, 23:59:59.999 UTC.
 */
function nextOffSeasonEnd(at: number): number {
  const d = new Date(at);
  // Le janvier « suivant » est toujours celui de l'année d'après, puisqu'on
  // n'appelle cette fonction que sur une date de haute saison (mai-septembre).
  const year = d.getUTCFullYear() + 1;
  return Date.UTC(year, OFF_SEASON_LANDING_MONTH + 1, 0, 23, 59, 59, 999);
}

/**
 * Échéance d'un cadeau accordé à `grantedAt` pour `months` mois.
 *
 * ## Pourquoi l'échéance n'est pas simplement `grantedAt + months`
 *
 * Le produit se juge **au mariage** : les RSVP qui tombent, le check-in à la
 * porte, la galerie partagée. Or une planneuse ne bascule pas dans un nouvel
 * outil un mariage dont les invitations sont parties : le premier qu'elle y
 * fera vraiment passer est à quatre mois au moins, donc en pratique la saison
 * suivante. Un cadeau qui s'arrête avant ne lui a montré qu'un CRM.
 *
 * Compter en mois depuis l'inscription fait pire encore quand le partenaire
 * s'inscrit entre mai et septembre — c'est-à-dire quand il entend parler de
 * nous, en pleine saison : douze mois plus tard, l'échéance retombe en pleine
 * saison. Au plus mauvais moment sur deux plans. D'abord parce qu'on lui
 * demande d'arbitrer un abonnement la semaine où il enchaîne trois mariages.
 * Ensuite parce que `galleryAccessFor` ferme les galeries d'une agence sans
 * couverture : ce ne sont pas ses photos qui disparaissent, ce sont celles de
 * ses clients, en pleine livraison.
 *
 * L'échéance est donc **repoussée** — jamais avancée, ce qui trahirait la durée
 * promise — au 31 janvier suivant lorsqu'elle tombe en haute saison. Le cadeau
 * couvre alors une saison entière, laisse les galeries ouvertes pendant toute
 * la traîne d'automne, et pose la question de l'abonnement quand elle peut
 * s'entendre.
 *
 * Conséquence assumée : la durée réelle varie selon le mois d'inscription
 * (12 mois pour une inscription d'octobre à décembre, jusqu'à ~20 pour une
 * inscription de mai). C'est la DATE qui est choisie ici, pas la durée.
 */
export function compExpiresAt(grantedAt: number, months = DEFAULT_PARTNER_COMP_MONTHS): number {
  const raw = addMonthsUtc(grantedAt, months);
  return isHighSeason(raw) ? nextOffSeasonEnd(raw) : raw;
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
