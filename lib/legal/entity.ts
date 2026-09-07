/**
 * Identité légale de l'entité qui exploite Wedillybird.
 *
 * Ces informations ne sont **pas** des traductions : le SIREN d'une société est
 * le même en arabe qu'en français. Les avoir dupliquées dans les sept fichiers
 * de messages, c'était sept endroits à corriger le jour d'un changement, et
 * sept occasions d'en oublier un — d'où ce module unique, dont les fichiers
 * i18n ne portent plus que les libellés.
 *
 * Ce que la loi impose sur une facture française (art. L441-9 du code de
 * commerce, art. 242 nonies A de l'annexe II au CGI) : dénomination, adresse du
 * siège, numéro d'identification (SIREN), et le numéro de TVA
 * intracommunautaire dès lors que l'entité est assujettie.
 *
 * ⚠️ Les champs à `null` ci-dessous ne sont pas facultatifs : ils sont
 * **manquants**. Ils s'imprimeraient sur de vraies factures et sur la page de
 * mentions légales, donc ils ne sont pas inventés. `pendingLegalFields()` les
 * énumère, et un test garde la liste à jour pour qu'elle ne s'oublie pas.
 */

export interface LegalEntity {
  /** Dénomination sociale immatriculée. */
  legalName: string;
  /** Nom commercial sous lequel le service est exploité. */
  tradeName: string;
  /** 9 chiffres, sans espaces. */
  siren: string;
  /**
   * TVA intracommunautaire. Pour une entité française, elle se déduit du SIREN
   * (clé = (12 + 3 × (SIREN mod 97)) mod 97) — un test vérifie que la valeur
   * écrite ici correspond bien au SIREN, pour qu'une faute de frappe ne parte
   * pas sur une facture.
   */
  vatNumber: string;
  /** SIREN + NIC de l'établissement. `null` tant que le NIC est inconnu. */
  siret: string | null;
  /** Forme juridique immatriculée (SAS, SASU, EURL…). */
  legalForm: string | null;
  /** Capital social en centimes d'euro. */
  shareCapitalMinor: number | null;
  /** Adresse du siège, une entrée par ligne. */
  registeredAddress: readonly string[] | null;
  /** Ville du greffe d'immatriculation (mention « RCS <ville> <SIREN> »). */
  rcsCity: string | null;
  /** Directeur de la publication (obligatoire, art. 6 III LCEN). */
  publicationDirector: string | null;
  /**
   * Médiateur de la consommation. Obligatoire dès lors qu'on vend à des
   * particuliers en France (art. L612-1 du code de la consommation) : le nom et
   * l'adresse du site du médiateur doivent figurer sur le site et les CGV.
   */
  consumerMediator: { name: string; url: string } | null;
  contactEmail: string;
  billingEmail: string;
}

/**
 * Source : fiche Infogreffe fournie par le fondateur
 * (`infogreffe.fr/entreprise/tuum-agency/930817697`). Le SIREN en est extrait
 * et vérifié par sa clé de Luhn ; le reste de la fiche n'a pas pu être lu
 * depuis cet environnement (egress bloqué), d'où les champs restants à `null`.
 */
export const LEGAL_ENTITY: LegalEntity = {
  legalName: 'Tuum Agency',
  tradeName: 'Wedillybird',
  siren: '930817697',
  vatNumber: 'FR31930817697',
  siret: null,
  legalForm: null,
  shareCapitalMinor: null,
  registeredAddress: null,
  rcsCity: null,
  publicationDirector: null,
  consumerMediator: null,
  contactEmail: 'contact@wedillybird.com',
  billingEmail: 'billing@wedillybird.com',
};

/** Hébergeur du service — mention obligatoire (art. 6 III LCEN). */
export const HOST_PROVIDER = {
  name: 'Vercel Inc.',
  url: 'https://vercel.com',
} as const;

/**
 * Champs d'identité encore manquants.
 *
 * Cette liste doit être **vide** avant la première vente : une facture sans
 * adresse de siège n'est pas conforme (art. L441-9 du code de commerce), et
 * une page de mentions légales sans directeur de publication ni médiateur ne
 * l'est pas davantage (art. 6 III LCEN, art. L612-1 du code de la
 * consommation).
 *
 * La page `/legal/mentions` et la facture **omettent** les lignes inconnues
 * plutôt que d'afficher un gabarit : une mention absente se corrige, une
 * mention « à compléter » part chez un vrai client.
 */
export function pendingLegalFields(entity: LegalEntity = LEGAL_ENTITY): string[] {
  const pending: string[] = [];
  if (!entity.siret) pending.push('siret');
  if (!entity.legalForm) pending.push('legalForm');
  if (entity.shareCapitalMinor === null) pending.push('shareCapitalMinor');
  if (!entity.registeredAddress?.length) pending.push('registeredAddress');
  if (!entity.rcsCity) pending.push('rcsCity');
  if (!entity.publicationDirector) pending.push('publicationDirector');
  if (!entity.consumerMediator) pending.push('consumerMediator');
  return pending;
}

/** Vrai si le SIREN respecte sa clé de contrôle (Luhn sur 9 chiffres). */
export function isValidSiren(siren: string): boolean {
  if (!/^\d{9}$/.test(siren)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let digit = Number(siren[i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

/**
 * Clé de TVA intracommunautaire française d'un SIREN, sur deux chiffres.
 * Formule officielle : (12 + 3 × (SIREN mod 97)) mod 97.
 */
export function frenchVatKey(siren: string): string {
  const key = (12 + 3 * (Number(siren) % 97)) % 97;
  return String(key).padStart(2, '0');
}

/** Numéro de TVA intracommunautaire attendu pour un SIREN français. */
export function frenchVatNumber(siren: string): string {
  return `FR${frenchVatKey(siren)}${siren}`;
}

/** `930817697` → `930 817 697`, la présentation usuelle sur un document. */
export function formatSiren(siren: string): string {
  return siren.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3');
}

/** `93081769700012` → `930 817 697 00012`. */
export function formatSiret(siret: string): string {
  return siret.replace(/(\d{3})(\d{3})(\d{3})(\d{5})/, '$1 $2 $3 $4');
}
