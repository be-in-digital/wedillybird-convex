import { describe, expect, it } from 'vitest';
import {
  needsSeatNotification,
  partyIsSplit,
  resolveSeatingPublication,
  seatSummary,
  type SeatNotificationState,
  type SeatPassMember,
} from '../../../convex/lib/seatPass';

/**
 * Règles du pass placement. Le point sensible est `needsSeatNotification` :
 * c'est lui qui décide qui reçoit un message. Un faux positif spamme
 * 200 personnes, un faux négatif laisse un invité devant une table qui n'est
 * plus la sienne.
 */

const guest = (over: Partial<SeatNotificationState> = {}): SeatNotificationState => ({
  rsvpStatus: 'attending',
  ...over,
});

const member = (
  fullName: string,
  tableName: string | null,
  seatNumber: number | null,
  memberIndex = 0,
): SeatPassMember => ({ memberIndex, fullName, tableName, seatNumber });

const LABELS = {
  seatOne: (n: number) => `place ${n}`,
  seatMany: (list: string) => `places ${list}`,
  join: ' et ',
};

describe('resolveSeatingPublication', () => {
  it('config absente → brouillon, numérotation par chaise, plan joint', () => {
    expect(resolveSeatingPublication(undefined)).toEqual({
      published: false,
      publishedAt: null,
      numbering: 'seat',
      showRoomPlan: true,
      note: null,
    });
  });

  it('`published` non strictement vrai reste faux', () => {
    expect(resolveSeatingPublication(null).published).toBe(false);
  });

  it('conserve les réglages explicites', () => {
    expect(
      resolveSeatingPublication({
        published: true,
        publishedAt: 42,
        numbering: 'table',
        showRoomPlan: false,
        note: 'Dîner à 20 h',
      }),
    ).toEqual({
      published: true,
      publishedAt: 42,
      numbering: 'table',
      showRoomPlan: false,
      note: 'Dîner à 20 h',
    });
  });
});

describe('needsSeatNotification', () => {
  it('invité placé jamais prévenu → à notifier', () => {
    expect(needsSeatNotification(guest({ seatAssignedAt: 100 }), true)).toBe(true);
  });

  it('invité non placé → jamais notifié', () => {
    expect(needsSeatNotification(guest({ seatAssignedAt: 100 }), false)).toBe(false);
  });

  it('invité absent ou sans réponse → jamais notifié', () => {
    for (const status of ['declined', 'pending', 'maybe'] as const) {
      expect(needsSeatNotification(guest({ rsvpStatus: status, seatAssignedAt: 100 }), true)).toBe(
        false,
      );
    }
  });

  it('déjà prévenu et place inchangée → pas de doublon', () => {
    expect(needsSeatNotification(guest({ seatAssignedAt: 100, seatNotifiedAt: 200 }), true)).toBe(
      false,
    );
  });

  it('place déplacée après le dernier envoi → à re-notifier', () => {
    expect(needsSeatNotification(guest({ seatAssignedAt: 300, seatNotifiedAt: 200 }), true)).toBe(
      true,
    );
  });

  it('placement et notification au même instant → pas de re-envoi', () => {
    expect(needsSeatNotification(guest({ seatAssignedAt: 200, seatNotifiedAt: 200 }), true)).toBe(
      false,
    );
  });

  it('prévenu sans `seatAssignedAt` connu → pas de re-envoi', () => {
    expect(needsSeatNotification(guest({ seatNotifiedAt: 200 }), true)).toBe(false);
  });
});

describe('seatSummary', () => {
  it('personne de placé → null (rien à annoncer)', () => {
    expect(seatSummary([member('Awa', null, null)], 'seat', LABELS)).toBeNull();
  });

  it('une personne avec chaise', () => {
    expect(seatSummary([member('Awa', 'Table des Pivoines', 4)], 'seat', LABELS)).toBe(
      'Table des Pivoines · place 4',
    );
  });

  it('plusieurs chaises, triées', () => {
    const members = [
      member('Awa', 'Table des Pivoines', 5),
      member('Ali', 'Table des Pivoines', 4, 1),
    ];
    expect(seatSummary(members, 'seat', LABELS)).toBe('Table des Pivoines · places 4 et 5');
  });

  it('numérotation « table » → on ne divulgue pas la chaise', () => {
    expect(seatSummary([member('Awa', 'Table des Pivoines', 4)], 'table', LABELS)).toBe(
      'Table des Pivoines',
    );
  });

  it('placé à une table sans chaise → nom de table seul', () => {
    expect(seatSummary([member('Awa', 'Table des Pivoines', null)], 'seat', LABELS)).toBe(
      'Table des Pivoines',
    );
  });

  it('ignore les membres non placés pour choisir la table', () => {
    const members = [member('Awa', null, null), member('Ali', 'Table Iris', 2, 1)];
    expect(seatSummary(members, 'seat', LABELS)).toBe('Table Iris · place 2');
  });
});

describe('partyIsSplit', () => {
  it('même table → pas éclatée', () => {
    expect(partyIsSplit([member('Awa', 'T1', 1), member('Ali', 'T1', 2, 1)])).toBe(false);
  });

  it('deux tables → éclatée', () => {
    expect(partyIsSplit([member('Awa', 'T1', 1), member('Ali', 'T2', 2, 1)])).toBe(true);
  });

  it('un membre non placé ne compte pas comme une seconde table', () => {
    expect(partyIsSplit([member('Awa', 'T1', 1), member('Ali', null, null, 1)])).toBe(false);
  });
});
