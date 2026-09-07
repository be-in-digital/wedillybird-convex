import { describe, expect, it } from 'vitest';
import { matchesConfiguredAdmin } from '../../../convex/lib/adminPromotion';
import { normalizePhone } from '../../../convex/lib/phone';
import { normalizeEmail } from '../../../convex/lib/email';

/**
 * `ADMIN_PHONE` / `ADMIN_EMAIL` sont la SEULE voie d'accès à `/admin` : aucun
 * écran ne permet de se nommer soi-même administrateur. Une comparaison qui
 * échoue ne laisse donc aucune trace exploitable — on se connecte, on n'est
 * pas admin, et il n'y a ni message ni log pour dire pourquoi. D'où une table
 * de vérité exhaustive.
 */

const phone = (value: string) => normalizePhone(value);
const email = (value: string) => normalizeEmail(value);

describe('matchesConfiguredAdmin — téléphone', () => {
  const actual = '+33612931779';

  it('accepte la valeur déjà en E.164', () => {
    expect(matchesConfiguredAdmin({ configured: '+33612931779', actual, normalize: phone })).toBe(
      true,
    );
  });

  it('accepte les formes humaines du même numéro', () => {
    // C'est le point : ces valeurs échouaient AVANT, en silence.
    for (const configured of [
      '06 12 93 17 79',
      '0612931779',
      '+33 6 12 93 17 79',
      '0033612931779',
    ]) {
      expect(matchesConfiguredAdmin({ configured, actual, normalize: phone }), configured).toBe(
        true,
      );
    }
  });

  it('refuse un autre numéro', () => {
    expect(matchesConfiguredAdmin({ configured: '+33612931770', actual, normalize: phone })).toBe(
      false,
    );
  });

  it('refuse une variable absente, vide ou non normalisable', () => {
    for (const configured of [undefined, null, '', '   ', 'pas-un-numéro']) {
      expect(
        matchesConfiguredAdmin({ configured, actual, normalize: phone }),
        String(configured),
      ).toBe(false);
    }
  });
});

describe('matchesConfiguredAdmin — e-mail', () => {
  const actual = 'hello@wedillybird.com';

  it('accepte la casse et les espaces du monde réel', () => {
    for (const configured of [
      'hello@wedillybird.com',
      'Hello@Wedillybird.com',
      '  HELLO@WEDILLYBIRD.COM  ',
    ]) {
      expect(matchesConfiguredAdmin({ configured, actual, normalize: email }), configured).toBe(
        true,
      );
    }
  });

  it('refuse une autre adresse', () => {
    expect(
      matchesConfiguredAdmin({ configured: 'hello@wedillybird.fr', actual, normalize: email }),
    ).toBe(false);
    // Pas de correspondance partielle : un sous-domaine ou un préfixe ne
    // donnerait sinon les clés de l'admin à qui contrôle une autre boîte.
    expect(
      matchesConfiguredAdmin({
        configured: 'hello@wedillybird.com.evil.tld',
        actual,
        normalize: email,
      }),
    ).toBe(false);
    expect(matchesConfiguredAdmin({ configured: 'hello', actual, normalize: email })).toBe(false);
  });

  it('refuse une variable absente ou vide', () => {
    for (const configured of [undefined, null, '', '   ']) {
      expect(
        matchesConfiguredAdmin({ configured, actual, normalize: email }),
        String(configured),
      ).toBe(false);
    }
  });
});

describe('matchesConfiguredAdmin — garde-fous transverses', () => {
  it('un identifiant vide ne matche jamais, même variable posée', () => {
    expect(
      matchesConfiguredAdmin({ configured: 'hello@wedillybird.com', actual: '', normalize: email }),
    ).toBe(false);
    expect(
      matchesConfiguredAdmin({ configured: '+33612931779', actual: '', normalize: phone }),
    ).toBe(false);
  });

  it('ne promeut pas sur une normalisation qui rend null', () => {
    expect(
      matchesConfiguredAdmin({ configured: '+1', actual: '+33612931779', normalize: phone }),
    ).toBe(false);
  });
});
