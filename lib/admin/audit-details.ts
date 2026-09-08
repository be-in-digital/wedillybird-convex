/**
 * Lecture des `details` du journal d'audit.
 *
 * Côté Convex, chaque écriture fait `JSON.stringify({...})` : l'écran d'audit
 * affichait donc l'objet brut, tronqué à la largeur de la colonne. Une
 * suppression de compte s'y lisait
 * `{"label":"Marie Dupont","role":"couple","deleted":{"events":3,"guests":142…`
 * — c'est-à-dire pas du tout.
 *
 * On repasse la charge en champs nommés, en formatant ce dont le **type** est
 * certain (montants, dates, booléens, identifiants, compteurs) plutôt qu'en
 * traduisant des valeurs métier dont le sens dépend de l'action : un `'active'`
 * ne veut pas dire la même chose sur un abonnement et sur un affilié, et une
 * mauvaise traduction dans un journal d'audit est pire qu'une valeur brute.
 *
 * Deux cas sont reconnus parce qu'ils portent l'essentiel de ce qu'un journal
 * raconte : les transitions « avant → après », et les inventaires de cascade.
 */

import { formatDateTime, formatMoneyMinor } from './format';

export interface AuditValue {
  text: string;
  /** Identifiant technique : rendu en mono, tronqué, valeur entière en `title`. */
  mono?: boolean;
  /** Valeur absente — le champ existe mais ne dit rien. */
  muted?: boolean;
  title?: string;
}

export type AuditField =
  | { kind: 'value'; key: string; label: string; value: AuditValue }
  | { kind: 'transition'; key: string; label: string; from: AuditValue; to: AuditValue }
  | {
      kind: 'counts';
      key: string;
      label: string;
      entries: ReadonlyArray<{ label: string; mono: boolean; count: number }>;
      total: number;
    };

export type AuditDetails =
  | { kind: 'fields'; fields: AuditField[] }
  /** JSON illisible ou texte libre : on montre la chaîne telle quelle. */
  | { kind: 'raw'; text: string }
  | { kind: 'empty' };

/** Libellés des clés produites par `convex/**`. */
const LABELS: Record<string, string> = {
  affiliateCode: 'Code affilié',
  code: 'Code',
  currency: 'Devise',
  decision: 'Décision',
  deleted: 'Documents supprimés',
  displayName: 'Nom affiché',
  eventId: 'Événement',
  from: 'Depuis',
  fullName: 'Nom',
  grantMonths: 'Durée offerte',
  grantTier: 'Palier offert',
  invitesDeleted: 'Invitations supprimées',
  kind: 'Nature',
  label: 'Compte',
  mode: 'Mode',
  newRole: 'Nouveau rôle',
  newStatus: 'Nouveau statut',
  ownerEmail: 'E-mail du porteur',
  ownerUserId: 'Porteur',
  payoutReference: 'Référence de versement',
  planTier: 'Formule',
  previousPlan: 'Formule précédente',
  previousRole: 'Rôle précédent',
  previousStatus: 'Statut précédent',
  reassignedEvents: 'Événements réattribués',
  reason: 'Motif',
  refundAmountMinor: 'Montant remboursé',
  revokedPrevious: 'Lien précédent révoqué',
  rewardMinor: 'Récompense',
  rewardType: 'Type de récompense',
  role: 'Rôle',
  s3Objects: 'Fichiers S3',
  stripeCouponId: 'Coupon Stripe',
  stripePromotionCodeId: 'Code promo Stripe',
  stripeRefundId: 'Remboursement Stripe',
  suspendedAt: 'Suspendu le',
  tier: 'Palier',
  title: 'Titre',
  to: 'Vers',
  totalRefunded: 'Total remboursé',
  validityDays: 'Validité',
};

/**
 * Couples « avant / après ».
 *
 * Une transition ne se forme QUE si les deux clés sont présentes : plusieurs
 * actions journalisent un `previousStatus` seul (l'état d'où l'on part, sans
 * état d'arrivée explicite), et l'afficher comme une flèche vers rien
 * mentirait sur ce que le journal contient.
 */
const TRANSITIONS: ReadonlyArray<{ from: string; to: string; label: string }> = [
  { from: 'from', to: 'to', label: 'Statut' },
  { from: 'previousStatus', to: 'newStatus', label: 'Statut' },
  { from: 'previousRole', to: 'newRole', label: 'Rôle' },
  { from: 'previousPlan', to: 'planTier', label: 'Formule' },
];

/** Tables de la cascade de suppression, pour l'inventaire de `delete_user`. */
const TABLE_LABELS: Record<string, string> = {
  budgetLines: 'Lignes de budget',
  budgetPayments: 'Paiements de budget',
  clients: 'Clients',
  clientNotes: 'Notes client',
  contracts: 'Contrats',
  coupleVendors: 'Prestataires',
  couplePayments: 'Paiements',
  coupleTasks: 'Tâches',
  events: 'Événements',
  eventCollaborators: 'Collaborateurs',
  guests: 'Invités',
  notifications: 'Notifications',
  organizations: 'Organisations',
  organizationMemberships: 'Membres d’organisation',
  photos: 'Photos',
  photoBookOrders: 'Commandes de livre photo',
  planningTasks: 'Tâches de planning',
  quoteDocs: 'Devis',
  magicLinkSessions: 'Sessions par lien',
  otpSessions: 'Sessions par code',
  paygPurchases: 'Achats à l’unité',
  paymentLinks: 'Liens de paiement',
  photoFaces: 'Visages détectés',
  photoModerationAlerts: 'Alertes de modération',
  planningTemplates: 'Modèles de planning',
  quoteActivity: 'Activité devis',
  smsDeliveries: 'SMS envoyés',
  smsDeliveryAlerts: 'Alertes SMS',
  tables: 'Tables',
  tableAssignments: 'Placements',
  users: 'Comptes',
  vendors: 'Prestataires',
  vendorEngagements: 'Engagements prestataires',
  whatsappTemplates: 'Modèles WhatsApp',
};

/** Clés dont la valeur est un identifiant : illisible en entier, inutile à lire. */
const ID_KEYS = new Set([
  'eventId',
  'ownerUserId',
  'stripeCouponId',
  'stripePromotionCodeId',
  'stripeRefundId',
]);

const EMPTY: AuditValue = { text: '—', muted: true };

function labelOf(key: string): string {
  return LABELS[key] ?? key;
}

function idValue(raw: string): AuditValue {
  return raw.length > 14
    ? { text: `${raw.slice(0, 12)}…`, mono: true, title: raw }
    : { text: raw, mono: true };
}

/** Une valeur scalaire, formatée par ce que sa clé et son type disent d'elle. */
function scalar(key: string, raw: unknown, currency: string, locale: string): AuditValue {
  if (raw === null || raw === undefined || raw === '') return EMPTY;
  if (typeof raw === 'boolean') return { text: raw ? 'Oui' : 'Non' };

  if (typeof raw === 'number') {
    // Les montants sont en unité mineure — la devise vient d'une clé sœur.
    if (key.endsWith('Minor') || key === 'totalRefunded') {
      return { text: formatMoneyMinor(raw, currency, locale) };
    }
    // Un `*At` est un timestamp ; le rendre en entier serait le rendre muet.
    if (key.endsWith('At')) return { text: formatDateTime(raw, locale) };
    if (key === 'grantMonths') return { text: `${raw} mois` };
    if (key === 'validityDays') return { text: `${raw} jours` };
    return { text: new Intl.NumberFormat(locale).format(raw) };
  }

  const text = String(raw);
  return ID_KEYS.has(key) ? idValue(text) : { text };
}

/** Inventaire d'une cascade : `{ events: 3, guests: 142 }`. */
function countsField(key: string, raw: Record<string, unknown>): AuditField | null {
  const entries = Object.entries(raw)
    .filter((e): e is [string, number] => typeof e[1] === 'number' && e[1] > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([table, count]) => ({
      // Sans libellé connu, on montre le nom de table tel quel, en mono : un
      // identifiant technique assumé vaut mieux qu'une traduction inventée.
      label: TABLE_LABELS[table] ?? table,
      mono: !(table in TABLE_LABELS),
      count,
    }));
  if (entries.length === 0) return null;
  return {
    kind: 'counts',
    key,
    label: labelOf(key),
    entries,
    total: entries.reduce((sum, e) => sum + e.count, 0),
  };
}

/**
 * Décode la charge `details` d'une entrée du journal.
 *
 * Ne lève jamais : une entrée ancienne ou écrite à la main doit rester lisible,
 * fût-ce en texte brut — un journal d'audit qui masque ce qu'il ne comprend pas
 * ne remplit plus son office.
 */
export function parseAuditDetails(details: string | undefined, locale = 'fr-FR'): AuditDetails {
  const trimmed = details?.trim();
  if (!trimmed) return { kind: 'empty' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { kind: 'raw', text: trimmed };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { kind: 'raw', text: trimmed };
  }

  const payload = parsed as Record<string, unknown>;
  const currency = typeof payload.currency === 'string' ? payload.currency : 'EUR';
  const consumed = new Set<string>();
  const fields: AuditField[] = [];

  // La devise n'est pas une information en soi : elle sert à écrire les
  // montants. On ne l'affiche que si aucun montant ne l'a utilisée.
  const hasAmount = Object.keys(payload).some((k) => k.endsWith('Minor') || k === 'totalRefunded');
  if (hasAmount) consumed.add('currency');

  for (const [key, raw] of Object.entries(payload)) {
    if (consumed.has(key)) continue;

    const transition = TRANSITIONS.find((t) => t.from === key && t.to in payload);
    if (transition) {
      consumed.add(transition.from);
      consumed.add(transition.to);
      fields.push({
        kind: 'transition',
        key,
        label: transition.label,
        from: scalar(transition.from, payload[transition.from], currency, locale),
        to: scalar(transition.to, payload[transition.to], currency, locale),
      });
      continue;
    }

    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
      const counts = countsField(key, raw as Record<string, unknown>);
      if (counts) fields.push(counts);
      consumed.add(key);
      continue;
    }

    consumed.add(key);
    fields.push({
      kind: 'value',
      key,
      label: labelOf(key),
      value: scalar(key, raw, currency, locale),
    });
  }

  return fields.length > 0 ? { kind: 'fields', fields } : { kind: 'empty' };
}

/** Résumé d'une ligne : le texte que l'admin lit sans ouvrir le détail. */
export function summarizeAuditField(field: AuditField): string {
  switch (field.kind) {
    case 'value':
      return `${field.label} ${field.value.text}`;
    case 'transition':
      return `${field.label} ${field.from.text} → ${field.to.text}`;
    case 'counts':
      return `${field.label} ${field.total}`;
  }
}
