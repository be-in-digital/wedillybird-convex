import { describe, expect, it } from 'vitest';
import {
  checkNationalNumber,
  COUNTRIES,
  expectedNationalDigits,
  FR,
} from '../../../lib/phone-countries';

/**
 * Longueur nationale par pays.
 *
 * La validation E.164 générique accepte 8 à 15 chiffres tous pays confondus :
 * un numéro sénégalais amputé de deux chiffres la franchit sans bruit, puis le
 * code WhatsApp part dans le vide. L'utilisateur attend alors un message qui
 * n'arrivera jamais, sans rien à l'écran pour l'expliquer. Ces tests verrouillent
 * la détection en amont.
 */

const country = (code: string) => {
  const c = COUNTRIES.find((x) => x.code === code);
  if (!c) throw new Error(`pays absent du catalogue : ${code}`);
  return c;
};

describe('expectedNationalDigits', () => {
  it('déduit la longueur du placeholder du pays', () => {
    expect(expectedNationalDigits(country('SN'))).toBe(9); // 77 123 45 67
    expect(expectedNationalDigits(FR)).toBe(9); // 6 12 34 56 78
    expect(expectedNationalDigits(country('US'))).toBe(10); // 555 123 4567
  });

  it('chaque pays du catalogue porte un placeholder exploitable', () => {
    for (const c of COUNTRIES) {
      expect(
        expectedNationalDigits(c),
        `${c.code} sans chiffres dans le placeholder`,
      ).toBeGreaterThan(0);
    }
  });
});

describe('checkNationalNumber', () => {
  it('rejette le numéro sénégalais trop court du rapport terrain', () => {
    // +221 471 12 62 → 7 chiffres au lieu de 9. Acceptée par E.164 (10 chiffres
    // au total, dans la fourchette 8–15), donc invisible sans ce contrôle.
    expect(checkNationalNumber(country('SN'), '4711262')).toBe('tooShort');
  });

  it('accepte un mobile sénégalais complet', () => {
    expect(checkNationalNumber(country('SN'), '771234567')).toBe('ok');
  });

  it('ignore les séparateurs de saisie', () => {
    expect(checkNationalNumber(country('SN'), '77 123 45 67')).toBe('ok');
    expect(checkNationalNumber(FR, '6 12 34 56 78')).toBe('ok');
  });

  it('champ vide → `empty`, jamais une erreur de longueur', () => {
    // Sinon le composant afficherait une erreur avant toute frappe.
    expect(checkNationalNumber(FR, '')).toBe('empty');
    expect(checkNationalNumber(FR, '   ')).toBe('empty');
  });

  it('signale aussi le numéro trop long', () => {
    expect(checkNationalNumber(FR, '6123456789012')).toBe('tooLong');
  });

  it('tolère ±1 chiffre — longueurs variables selon les opérateurs', () => {
    // Mieux vaut laisser passer un cas limite que bloquer un numéro valide.
    expect(checkNationalNumber(FR, '61234567')).toBe('ok'); // 8, attendu 9
    expect(checkNationalNumber(FR, '6123456789')).toBe('ok'); // 10, attendu 9
    expect(checkNationalNumber(FR, '6123456')).toBe('tooShort'); // 7 → rejeté
  });

  it('le placeholder proposé au pays passe toujours son propre contrôle', () => {
    // Garde-fou : un placeholder incohérent avec sa tolérance afficherait une
    // erreur sur l'exemple que l'on suggère à l'utilisateur.
    for (const c of COUNTRIES) {
      expect(checkNationalNumber(c, c.placeholder), `${c.code}`).toBe('ok');
    }
  });
});
