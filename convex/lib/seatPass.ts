/**
 * Règles **pures** du « pass placement » — le carton de table numérique que
 * l'invité ouvre depuis son lien / QR code.
 *
 * Testé dans `tests/unit/convex/seat-pass.test.ts`. Aucun accès base ici : les
 * queries et actions Convex projettent leurs documents vers ces types puis
 * appliquent ces décisions, ce qui les rend vérifiables sans déploiement.
 */

/** Publication du plan côté invité (`events.seatingConfig`). */
export interface SeatingPublication {
  published: boolean;
  publishedAt?: number;
  numbering?: 'table' | 'seat';
  showRoomPlan?: boolean;
  note?: string;
}

/** Réglages effectifs, defaults appliqués — ce que consomme l'UI. */
export interface ResolvedSeatingPublication {
  published: boolean;
  publishedAt: number | null;
  numbering: 'table' | 'seat';
  showRoomPlan: boolean;
  note: string | null;
}

/**
 * Applique les valeurs par défaut d'un plan jamais configuré : non publié,
 * numérotation par chaise, plan de salle joint.
 */
export function resolveSeatingPublication(
  config: SeatingPublication | undefined | null,
): ResolvedSeatingPublication {
  return {
    published: config?.published === true,
    publishedAt: config?.publishedAt ?? null,
    numbering: config?.numbering ?? 'seat',
    showRoomPlan: config?.showRoomPlan ?? true,
    note: config?.note ?? null,
  };
}

/** Champs de suivi d'envoi portés par `guests`. */
export interface SeatNotificationState {
  rsvpStatus: 'pending' | 'attending' | 'declined' | 'maybe';
  seatAssignedAt?: number;
  seatNotifiedAt?: number;
}

/**
 * Cet invité doit-il recevoir (ou re-recevoir) son pass ?
 *
 * Oui si la tablée est placée, l'invité présent, et qu'il n'a jamais été
 * prévenu **ou** que son placement a bougé depuis le dernier envoi. C'est ce
 * qui permet à l'organisateur de remanier son plan la veille et de ne relancer
 * que les invités réellement déplacés — pas les 200 autres.
 */
export function needsSeatNotification(guest: SeatNotificationState, placed: boolean): boolean {
  if (!placed) return false;
  if (guest.rsvpStatus !== 'attending') return false;
  if (!guest.seatNotifiedAt) return true;
  return (guest.seatAssignedAt ?? 0) > guest.seatNotifiedAt;
}

/** Une personne de la tablée, telle qu'affichée sur le pass. */
export interface SeatPassMember {
  /** `0` = l'invité titulaire du lien, `>= 1` = un accompagnant. */
  memberIndex: number;
  fullName: string;
  tableName: string | null;
  seatNumber: number | null;
}

/**
 * Résumé texte d'une tablée, pour les canaux sans mise en page (SMS, corps de
 * template WhatsApp) et pour l'aperçu côté organisateur.
 *
 * Exemples :
 *   `Table des Pivoines · place 4`
 *   `Table des Pivoines · places 4 et 5`
 *   `Table des Pivoines` (numérotation 'table')
 */
export function seatSummary(
  members: ReadonlyArray<SeatPassMember>,
  numbering: 'table' | 'seat',
  labels: { seatOne: (n: number) => string; seatMany: (list: string) => string; join: string },
): string | null {
  const placed = members.filter((m) => m.tableName !== null);
  if (placed.length === 0) return null;
  const tableName = placed[0]!.tableName!;
  if (numbering === 'table') return tableName;

  const seats = placed
    .map((m) => m.seatNumber)
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b);
  if (seats.length === 0) return tableName;
  if (seats.length === 1) return `${tableName} · ${labels.seatOne(seats[0]!)}`;
  return `${tableName} · ${labels.seatMany(seats.join(labels.join))}`;
}

/**
 * Toutes les personnes de la tablée sont-elles à la même table ? Un `false`
 * signale à l'organisateur une famille éclatée sur plusieurs tables — légitime
 * parfois, mais qu'on veut voir avant de publier.
 */
export function partyIsSplit(members: ReadonlyArray<SeatPassMember>): boolean {
  const tables = new Set(members.map((m) => m.tableName).filter((t): t is string => t !== null));
  return tables.size > 1;
}
