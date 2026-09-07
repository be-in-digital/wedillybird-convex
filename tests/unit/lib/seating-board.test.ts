import { describe, expect, it } from 'vitest';
import {
  applyMove,
  containerOf,
  UNASSIGNED,
  withOccupancy,
  type BoardState,
  type SeatGuest,
} from '../../../lib/seating/board';

function guest(id: string, seats = 1): SeatGuest {
  return {
    _id: id,
    guestId: id,
    memberIndex: 0,
    fullName: `Guest ${id}`,
    seats,
    plusOnesNames: seats > 1 ? ['Plus'] : [],
    seatNumber: null,
  };
}

function table(id: string, capacity: number, assigned: SeatGuest[] = []) {
  return withOccupancy({
    _id: id,
    name: id,
    capacity,
    order: 0,
    assigned,
    occupancy: 0,
    overCapacity: false,
    seatConflicts: [],
    unnumbered: 0,
  });
}

describe('withOccupancy', () => {
  it('somme les sièges et calcule overCapacity', () => {
    const t = table('t1', 4, [guest('a', 2), guest('b', 1)]);
    expect(t.occupancy).toBe(3);
    expect(t.overCapacity).toBe(false);
  });

  it('overCapacity quand occupation > capacité (plus-ones comptés)', () => {
    const t = table('t1', 2, [guest('a', 2), guest('b', 1)]);
    expect(t.occupancy).toBe(3);
    expect(t.overCapacity).toBe(true);
  });
});

describe('containerOf', () => {
  const state: BoardState = {
    tables: [table('t1', 8, [guest('a')])],
    unassigned: [guest('b')],
  };
  it('trouve la table d’un invité assigné', () => {
    expect(containerOf(state, 'a')).toBe('t1');
  });
  it('retourne UNASSIGNED pour un invité non placé', () => {
    expect(containerOf(state, 'b')).toBe(UNASSIGNED);
  });
  it('retourne UNASSIGNED pour un invité inconnu', () => {
    expect(containerOf(state, 'zzz')).toBe(UNASSIGNED);
  });
});

describe('applyMove', () => {
  it('place un invité non assigné sur une table + met à jour l’occupation', () => {
    const state: BoardState = { tables: [table('t1', 8)], unassigned: [guest('a', 2)] };
    const next = applyMove(state, 'a', 't1');
    expect(next.unassigned).toHaveLength(0);
    expect(next.tables[0]!.assigned.map((g) => g._id)).toEqual(['a']);
    expect(next.tables[0]!.occupancy).toBe(2);
  });

  it('désassigne un invité (table → non placés)', () => {
    const state: BoardState = { tables: [table('t1', 8, [guest('a')])], unassigned: [] };
    const next = applyMove(state, 'a', UNASSIGNED);
    expect(next.tables[0]!.assigned).toHaveLength(0);
    expect(next.tables[0]!.occupancy).toBe(0);
    expect(next.unassigned.map((g) => g._id)).toEqual(['a']);
  });

  it('déplace entre deux tables + recalcule les deux', () => {
    const state: BoardState = {
      tables: [table('t1', 8, [guest('a', 2)]), table('t2', 8)],
      unassigned: [],
    };
    const next = applyMove(state, 'a', 't2');
    expect(next.tables[0]!.occupancy).toBe(0);
    expect(next.tables[1]!.assigned.map((g) => g._id)).toEqual(['a']);
    expect(next.tables[1]!.occupancy).toBe(2);
  });

  it('signale la sur-capacité après déplacement', () => {
    const state: BoardState = {
      tables: [table('t1', 2, [guest('x', 2)])],
      unassigned: [guest('a', 1)],
    };
    const next = applyMove(state, 'a', 't1');
    expect(next.tables[0]!.occupancy).toBe(3);
    expect(next.tables[0]!.overCapacity).toBe(true);
  });

  it('no-op (état identique) si l’invité est introuvable', () => {
    const state: BoardState = { tables: [table('t1', 8)], unassigned: [guest('a')] };
    const next = applyMove(state, 'zzz', 't1');
    expect(next).toBe(state);
  });

  it('ne mute pas l’état d’entrée (immutable)', () => {
    const state: BoardState = { tables: [table('t1', 8)], unassigned: [guest('a')] };
    applyMove(state, 'a', 't1');
    expect(state.unassigned).toHaveLength(1);
    expect(state.tables[0]!.assigned).toHaveLength(0);
  });
});
