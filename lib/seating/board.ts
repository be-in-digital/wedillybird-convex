/**
 * Logique pure du board de plan de table (seating), extraite du composant
 * client pour être testable unitairement. Aucune dépendance React/DOM.
 *
 * Conventions :
 *  - `UNASSIGNED` est le conteneur des invités non placés.
 *  - `seats` d'un invité = lui + ses plus-ones confirmés (déjà calculé côté
 *    Convex `getSeatingPlan`). On le traite ici comme une donnée d'entrée.
 */

export const UNASSIGNED = 'unassigned';

/**
 * Unité-personne placeable : soit l'invité principal (`memberIndex` 0), soit un
 * accompagnant (`memberIndex` >= 1, avec `hostName` = nom de l'invité hôte).
 * `_id` est l'identifiant d'unité (`guestId` ou `guestId:memberIndex`).
 */
export interface SeatGuest {
  _id: string;
  guestId: string;
  memberIndex: number;
  fullName: string;
  hostName?: string;
  seats: number;
  plusOnesNames: string[];
  category?: string;
  /** Chaise attribuée à cette personne (1-basée), `null` = pas de numéro. */
  seatNumber: number | null;
}

export interface SeatTable {
  _id: string;
  name: string;
  capacity: number;
  shape?: 'round' | 'rect';
  posX?: number;
  posY?: number;
  order: number;
  assigned: SeatGuest[];
  occupancy: number;
  overCapacity: boolean;
  /** Numéros de chaise attribués deux fois à cette table. */
  seatConflicts: Array<{ seatNumber: number; unitIds: string[] }>;
  /** Personnes posées à la table sans numéro de chaise. */
  unnumbered: number;
}

export interface BoardState {
  tables: SeatTable[];
  unassigned: SeatGuest[];
}

export interface SeatingPlanStats {
  tableCount: number;
  totalCapacity: number;
  seatedSeats: number;
  unassignedSeats: number;
  attendingParties: number;
  seatConflicts: number;
  unnumbered: number;
}

/** Publication du plan côté invité, defaults déjà appliqués côté Convex. */
export interface SeatingPublication {
  published: boolean;
  publishedAt: number | null;
  numbering: 'table' | 'seat';
  showRoomPlan: boolean;
  note: string | null;
}

/** File d'envoi des pass placement. */
export interface SeatingNotifications {
  placedGuests: number;
  notified: number;
  needsNotify: number;
}

/** Forme renvoyée par la query `getSeatingPlan` (et consommée par l'UI). */
export interface SeatingPlan {
  tables: SeatTable[];
  unassigned: SeatGuest[];
  publication: SeatingPublication;
  notifications: SeatingNotifications;
  stats: SeatingPlanStats;
}

/**
 * Position par défaut (grille) d'une table sur le canvas du plan visuel quand
 * elle n'a pas encore de posX/posY persisté. Partagée entre le rendu (canvas)
 * et le calcul de repositionnement (board) pour rester cohérent.
 */
export function defaultTablePos(index: number): { x: number; y: number } {
  return { x: 24 + (index % 4) * 210, y: 24 + Math.floor(index / 4) * 190 };
}

/** Recalcule l'occupation (somme des sièges) et le flag sur-capacité d'une table. */
export function withOccupancy(table: SeatTable): SeatTable {
  const occupancy = table.assigned.reduce((sum, g) => sum + g.seats, 0);
  return { ...table, occupancy, overCapacity: occupancy > table.capacity };
}

/** Conteneur courant d'un invité : id de table, ou UNASSIGNED. */
export function containerOf(state: BoardState, guestId: string): string {
  if (state.unassigned.some((g) => g._id === guestId)) return UNASSIGNED;
  const table = state.tables.find((t) => t.assigned.some((g) => g._id === guestId));
  return table?._id ?? UNASSIGNED;
}

/**
 * Déplace un invité vers `target` (id de table ou UNASSIGNED), en le retirant
 * de son conteneur d'origine et en recalculant l'occupation des tables
 * touchées. Renvoie un nouvel état (immutable). No-op si l'invité est
 * introuvable.
 */
export function applyMove(state: BoardState, guestId: string, target: string): BoardState {
  let moved: SeatGuest | null = state.unassigned.find((g) => g._id === guestId) ?? null;
  let unassigned = moved ? state.unassigned.filter((g) => g._id !== guestId) : state.unassigned;
  let tables = state.tables.map((t) => {
    const hit = t.assigned.find((g) => g._id === guestId);
    if (hit) {
      moved = hit;
      return withOccupancy({ ...t, assigned: t.assigned.filter((g) => g._id !== guestId) });
    }
    return t;
  });

  if (!moved) return state;

  if (target === UNASSIGNED) {
    unassigned = [...unassigned, moved];
  } else {
    tables = tables.map((t) =>
      t._id === target ? withOccupancy({ ...t, assigned: [...t.assigned, moved as SeatGuest] }) : t,
    );
  }
  return { tables, unassigned };
}
