import { describe, expect, it } from 'vitest';
import {
  freeSeats,
  normalizeSeatNumber,
  planSeatMove,
  planTableNumbering,
  seatConflicts,
  type SeatNumberUnit,
} from '../../../convex/lib/seatNumbers';

/**
 * Numérotation des places — les deux invariants qui comptent le jour J :
 * personne ne partage une chaise, et une famille reste groupée.
 */

const u = (id: string, seatNumber: number | null = null, partyKey = id): SeatNumberUnit => ({
  _id: id,
  partyKey,
  seatNumber,
});

describe('normalizeSeatNumber', () => {
  it('accepte un entier dans les bornes de la table', () => {
    expect(normalizeSeatNumber(1, 8)).toBe(1);
    expect(normalizeSeatNumber(8, 8)).toBe(8);
  });

  it('rejette hors bornes, zéro et négatif', () => {
    expect(normalizeSeatNumber(0, 8)).toBeNull();
    expect(normalizeSeatNumber(9, 8)).toBeNull();
    expect(normalizeSeatNumber(-3, 8)).toBeNull();
  });

  it('rejette les non-nombres et arrondit les décimaux', () => {
    expect(normalizeSeatNumber(null, 8)).toBeNull();
    expect(normalizeSeatNumber(undefined, 8)).toBeNull();
    expect(normalizeSeatNumber(Number.NaN, 8)).toBeNull();
    expect(normalizeSeatNumber(Number.POSITIVE_INFINITY, 8)).toBeNull();
    expect(normalizeSeatNumber(3.4, 8)).toBe(3);
  });

  it('table de capacité 0 → aucune chaise valide', () => {
    expect(normalizeSeatNumber(1, 0)).toBeNull();
  });
});

describe('freeSeats', () => {
  it('rend les chaises libres dans l’ordre', () => {
    expect(freeSeats([2, 4], 5)).toEqual([1, 3, 5]);
  });

  it('table pleine → aucune chaise libre', () => {
    expect(freeSeats([1, 2, 3], 3)).toEqual([]);
  });

  it('ignore les numéros hors capacité', () => {
    expect(freeSeats([9], 3)).toEqual([1, 2, 3]);
  });
});

describe('seatConflicts', () => {
  it('aucun doublon → tableau vide', () => {
    expect(seatConflicts([u('a', 1), u('b', 2)])).toEqual([]);
  });

  it('signale chaque numéro attribué plusieurs fois', () => {
    const res = seatConflicts([u('a', 1), u('b', 1), u('c', 2), u('d', 2), u('e', 3)]);
    expect(res).toEqual([
      { seatNumber: 1, unitIds: ['a', 'b'] },
      { seatNumber: 2, unitIds: ['c', 'd'] },
    ]);
  });

  it('les personnes sans numéro ne sont jamais en conflit', () => {
    expect(seatConflicts([u('a'), u('b'), u('c')])).toEqual([]);
  });
});

describe('planTableNumbering — mode fill', () => {
  it('numérote tout le monde quand rien n’est posé', () => {
    const changes = planTableNumbering([u('a'), u('b'), u('c')], 8);
    expect(changes).toEqual([
      { _id: 'a', seatNumber: 1 },
      { _id: 'b', seatNumber: 2 },
      { _id: 'c', seatNumber: 3 },
    ]);
  });

  it('respecte les numéros posés à la main et comble les trous', () => {
    const changes = planTableNumbering([u('a', 3), u('b'), u('c', 1), u('d')], 8);
    // 1 et 3 sont gelés → b et d prennent les premières chaises libres (2, 4).
    expect(changes).toEqual([
      { _id: 'b', seatNumber: 2 },
      { _id: 'd', seatNumber: 4 },
    ]);
  });

  it('est idempotent : un plan déjà numéroté ne produit aucun changement', () => {
    const units = [u('a', 1), u('b', 2), u('c', 3)];
    expect(planTableNumbering(units, 8)).toEqual([]);
  });

  it('réattribue le doublon au second arrivé, jamais au premier', () => {
    const changes = planTableNumbering([u('a', 2), u('b', 2)], 8);
    expect(changes).toEqual([{ _id: 'b', seatNumber: 1 }]);
  });

  it('normalise un numéro hors bornes plutôt que de le garder', () => {
    const changes = planTableNumbering([u('a', 12)], 8);
    expect(changes).toEqual([{ _id: 'a', seatNumber: 1 }]);
  });

  it('table en sur-effectif : le surplus reste sans numéro (donc sans écriture)', () => {
    const changes = planTableNumbering([u('a'), u('b'), u('c')], 2);
    // `c` était déjà sans numéro : rien à écrire pour lui.
    expect(changes).toEqual([
      { _id: 'a', seatNumber: 1 },
      { _id: 'b', seatNumber: 2 },
    ]);
  });

  it('capacité réduite : le numéro devenu invalide est explicitement effacé', () => {
    // La table passe de 8 à 2 couverts — `c` tenait la chaise 5, qui n'existe
    // plus. Sans effacement, l'invité garderait une place fantôme sur son pass.
    const changes = planTableNumbering([u('a', 1), u('b', 2), u('c', 5)], 2);
    expect(changes).toEqual([{ _id: 'c', seatNumber: null }]);
  });

  it('garde les membres d’une même invitation contigus', () => {
    // Entrée entrelacée : a(P1), x(P2), b(P1) → P1 doit rester groupé.
    const changes = planTableNumbering(
      [u('a', null, 'P1'), u('x', null, 'P2'), u('b', null, 'P1')],
      8,
    );
    expect(changes).toEqual([
      { _id: 'a', seatNumber: 1 },
      { _id: 'b', seatNumber: 2 },
      { _id: 'x', seatNumber: 3 },
    ]);
  });
});

describe('planTableNumbering — mode renumber', () => {
  it('repart de 1 et écrase les numéros existants', () => {
    const changes = planTableNumbering([u('a', 5), u('b', 7)], 8, 'renumber');
    expect(changes).toEqual([
      { _id: 'a', seatNumber: 1 },
      { _id: 'b', seatNumber: 2 },
    ]);
  });

  it('groupe les tablées avant de numéroter', () => {
    const changes = planTableNumbering(
      [u('a', null, 'P1'), u('x', null, 'P2'), u('b', null, 'P1')],
      8,
      'renumber',
    );
    expect(changes.map((c) => c._id)).toEqual(['a', 'b', 'x']);
    expect(changes.map((c) => c.seatNumber)).toEqual([1, 2, 3]);
  });

  it('deux exécutions consécutives donnent le même plan (déterminisme)', () => {
    const units = [u('a', null, 'P1'), u('x', null, 'P2'), u('b', null, 'P1')];
    const first = planTableNumbering(units, 8, 'renumber');
    const applied = units.map((unit) => ({
      ...unit,
      seatNumber: first.find((c) => c._id === unit._id)?.seatNumber ?? unit.seatNumber,
    }));
    expect(planTableNumbering(applied, 8, 'renumber')).toEqual([]);
  });
});

describe('planSeatMove', () => {
  it('chaise libre → une seule écriture', () => {
    const occupants = [u('a', 1), u('b', 2)];
    expect(planSeatMove(occupants, 'a', 3, 8)).toEqual([{ _id: 'a', seatNumber: 3 }]);
  });

  it('chaise occupée → échange des deux personnes', () => {
    const occupants = [u('a', 1), u('b', 2)];
    expect(planSeatMove(occupants, 'a', 2, 8)).toEqual([
      { _id: 'a', seatNumber: 2 },
      { _id: 'b', seatNumber: 1 },
    ]);
  });

  it('un déplacé sans numéro laisse l’occupant sans numéro', () => {
    const occupants = [u('a', null), u('b', 2)];
    expect(planSeatMove(occupants, 'a', 2, 8)).toEqual([
      { _id: 'a', seatNumber: 2 },
      { _id: 'b', seatNumber: null },
    ]);
  });

  it('arrivée d’une autre table : l’occupant perd son numéro', () => {
    // `mover` absent des occupants = il vient d'ailleurs.
    const occupants = [u('b', 2)];
    expect(planSeatMove(occupants, 'a', 2, 8)).toEqual([
      { _id: 'a', seatNumber: 2 },
      { _id: 'b', seatNumber: null },
    ]);
  });

  it('même chaise → aucun changement', () => {
    expect(planSeatMove([u('a', 4)], 'a', 4, 8)).toEqual([]);
  });

  it('cible null → retire le numéro sans toucher aux autres', () => {
    expect(planSeatMove([u('a', 4), u('b', 5)], 'a', null, 8)).toEqual([
      { _id: 'a', seatNumber: null },
    ]);
  });

  it('cible hors bornes → traitée comme « pas de chaise »', () => {
    expect(planSeatMove([u('a', 4)], 'a', 99, 8)).toEqual([{ _id: 'a', seatNumber: null }]);
  });
});
