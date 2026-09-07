/**
 * Numérotation des places (chaises) d'une table — logique **pure**, sans accès
 * base, testée dans `tests/unit/convex/seat-numbers.test.ts`.
 *
 * Modèle : une table de capacité `capacity` expose les chaises `1..capacity`.
 * Une unité-personne posée à cette table porte soit un numéro dans cet
 * intervalle, soit `null` (« placée à la table, sans chaise nominative » — mode
 * `numbering: 'table'` côté `events.seatingConfig`).
 *
 * Deux invariants tenus par ce module :
 *  1. **Unicité** — deux personnes ne partagent jamais un numéro à une table.
 *  2. **Tablée contiguë** — les membres d'une même invitation (`partyKey`)
 *     reçoivent des chaises consécutives quand la place le permet, pour qu'un
 *     couple ne soit pas séparé par la numérotation automatique.
 */

/** Unité-personne telle que vue par la numérotation (ordre du tableau = priorité). */
export interface SeatNumberUnit {
  /** Identifiant d'unité (`guestId` ou `guestId:memberIndex`). */
  _id: string;
  /** Regroupement d'une même invitation — sert à garder la tablée contiguë. */
  partyKey: string;
  /** Numéro actuel, `null` si la personne n'a pas de chaise nominative. */
  seatNumber: number | null;
}

/** Changement à persister. `seatNumber: null` = retirer le numéro. */
export interface SeatNumberChange {
  _id: string;
  seatNumber: number | null;
}

export interface SeatConflict {
  seatNumber: number;
  unitIds: string[];
}

/**
 * Ramène une saisie utilisateur à un numéro valide pour une table de capacité
 * `capacity`, ou `null` (hors bornes, non entier, non fini → pas de chaise).
 */
export function normalizeSeatNumber(
  raw: number | null | undefined,
  capacity: number,
): number | null {
  if (raw === null || raw === undefined) return null;
  if (!Number.isFinite(raw)) return null;
  const n = Math.round(raw);
  if (n < 1 || n > Math.max(0, Math.floor(capacity))) return null;
  return n;
}

/** Chaises libres d'une table, dans l'ordre croissant. */
export function freeSeats(taken: Iterable<number>, capacity: number): number[] {
  const used = new Set<number>();
  for (const n of taken) used.add(n);
  const out: number[] = [];
  for (let i = 1; i <= Math.max(0, Math.floor(capacity)); i += 1) {
    if (!used.has(i)) out.push(i);
  }
  return out;
}

/**
 * Doublons de numéro à une table. Utilisé par l'UI organisateur pour signaler
 * un plan incohérent **avant** publication (deux invités sur la chaise 3).
 */
export function seatConflicts(units: ReadonlyArray<SeatNumberUnit>): SeatConflict[] {
  const byNumber = new Map<number, string[]>();
  for (const u of units) {
    if (u.seatNumber === null) continue;
    const arr = byNumber.get(u.seatNumber);
    if (arr) arr.push(u._id);
    else byNumber.set(u.seatNumber, [u._id]);
  }
  const out: SeatConflict[] = [];
  for (const [seatNumber, unitIds] of byNumber) {
    if (unitIds.length > 1) out.push({ seatNumber, unitIds });
  }
  return out.sort((a, b) => a.seatNumber - b.seatNumber);
}

export type NumberingMode = 'fill' | 'renumber';

/**
 * Calcule la numérotation d'**une** table.
 *
 * - `mode: 'fill'` (défaut) — respecte les numéros déjà posés à la main, ne
 *   touche qu'aux personnes sans chaise et aux doublons (le premier de l'ordre
 *   d'entrée garde le numéro, les suivants sont réattribués).
 * - `mode: 'renumber'` — repart de zéro : `1..N` en suivant l'ordre d'entrée,
 *   tablées groupées.
 *
 * Les unités au-delà de la capacité (table en sur-effectif) restent sans
 * numéro plutôt que de recevoir une chaise inexistante.
 *
 * Ne renvoie **que** les changements réels — appliquer un plan déjà numéroté
 * rend un tableau vide (idempotence).
 */
export function planTableNumbering(
  units: ReadonlyArray<SeatNumberUnit>,
  capacity: number,
  mode: NumberingMode = 'fill',
): SeatNumberChange[] {
  const ordered = groupByParty(units);
  const changes: SeatNumberChange[] = [];

  if (mode === 'renumber') {
    let next = 1;
    for (const u of ordered) {
      const seat = next <= capacity ? next : null;
      if (seat !== null) next += 1;
      if (u.seatNumber !== seat) changes.push({ _id: u._id, seatNumber: seat });
    }
    return changes;
  }

  // mode 'fill' : on gèle les numéros valides et uniques, on comble le reste.
  const kept = new Set<number>();
  const needsSeat: SeatNumberUnit[] = [];
  for (const u of ordered) {
    const valid = normalizeSeatNumber(u.seatNumber, capacity);
    if (valid !== null && !kept.has(valid)) {
      kept.add(valid);
      // Le numéro était hors bornes puis normalisé → il faut le réécrire.
      if (u.seatNumber !== valid) changes.push({ _id: u._id, seatNumber: valid });
      continue;
    }
    needsSeat.push(u);
  }

  const pool = freeSeats(kept, capacity);
  let i = 0;
  for (const u of needsSeat) {
    const seat = i < pool.length ? pool[i]! : null;
    if (seat !== null) i += 1;
    if (u.seatNumber !== seat) changes.push({ _id: u._id, seatNumber: seat });
  }
  return changes;
}

/**
 * Déplacement manuel d'une personne vers la chaise `targetSeat` d'une table.
 *
 * Si la chaise est déjà prise, on **échange** les deux personnes plutôt que de
 * refuser : c'est le geste attendu en drag-and-drop, et ça évite un état
 * transitoire où l'organisateur doit d'abord libérer la chaise. L'occupant
 * récupère l'ancienne chaise du déplacé (ou perd son numéro si le déplacé
 * n'en avait pas / venait d'une autre table).
 *
 * `occupants` = toutes les unités actuellement à la table cible, `mover`
 * inclus s'il y était déjà.
 */
export function planSeatMove(
  occupants: ReadonlyArray<SeatNumberUnit>,
  moverId: string,
  targetSeat: number | null,
  capacity: number,
): SeatNumberChange[] {
  const seat = normalizeSeatNumber(targetSeat, capacity);
  const mover = occupants.find((u) => u._id === moverId);
  const previous = mover ? normalizeSeatNumber(mover.seatNumber, capacity) : null;
  if (seat === previous) return [];
  if (seat === null) return [{ _id: moverId, seatNumber: null }];

  const holder = occupants.find((u) => u._id !== moverId && u.seatNumber === seat);
  const changes: SeatNumberChange[] = [{ _id: moverId, seatNumber: seat }];
  if (holder) changes.push({ _id: holder._id, seatNumber: previous });
  return changes;
}

/**
 * Réordonne pour que les membres d'une même invitation se suivent, en gardant
 * l'ordre d'apparition des tablées (tri stable, aucun aléa : deux exécutions
 * sur la même entrée rendent le même plan).
 */
function groupByParty(units: ReadonlyArray<SeatNumberUnit>): SeatNumberUnit[] {
  const parties = new Map<string, SeatNumberUnit[]>();
  for (const u of units) {
    const arr = parties.get(u.partyKey);
    if (arr) arr.push(u);
    else parties.set(u.partyKey, [u]);
  }
  return [...parties.values()].flat();
}
