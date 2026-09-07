import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { isUndeliverableRecipient } from '../../../convex/lib/whatsappCloud';

/**
 * Un numéro qui ne reçoit jamais son code ne laissait AUCUNE trace : Convex
 * jetait la raison de Meta, et l'écran affichait « une erreur est survenue »
 * pour tout. Impossible de distinguer un quota dépassé, un compte suspendu et
 * un destinataire que Meta refuse.
 */
describe('classification des refus Meta', () => {
  it('reconnaît un destinataire hors liste autorisée (WABA non vérifié)', () => {
    // 131030 : symptôme caractéristique — le numéro de test du compte marche,
    // tout autre numéro échoue.
    expect(isUndeliverableRecipient(131030)).toBe(true);
  });

  it('reconnaît un destinataire sans compte WhatsApp actif', () => {
    expect(isUndeliverableRecipient(131026)).toBe(true);
    expect(isUndeliverableRecipient(131051)).toBe(true);
  });

  it('ne classe pas un incident passager comme définitif', () => {
    // 131056 (throughput), 368 (compte restreint temporairement)… un réessai
    // a du sens ; dire « ce numéro ne peut pas recevoir » serait faux.
    expect(isUndeliverableRecipient(131056)).toBe(false);
    expect(isUndeliverableRecipient(undefined)).toBe(false);
  });
});

describe('la raison de Meta est journalisée', () => {
  const auth = readFileSync('convex/auth.ts', 'utf8');

  it("l'échec d'envoi OTP écrit le code et le message Meta", () => {
    expect(auth).toContain('[auth:whatsapp] envoi OTP refusé');
    expect(auth).toContain('code=${result.errorCode ?? ');
  });

  it('le refus définitif est distingué du reste', () => {
    expect(auth).toContain("throw new Error('WHATSAPP_UNDELIVERABLE')");
  });

  it('ne journalise JAMAIS le code OTP lui-même', () => {
    // Le log de diagnostic ne doit pas rouvrir la faille F-04 : hors mode mock,
    // aucun OTP en clair dans les logs.
    const block = auth.slice(auth.indexOf('[auth:whatsapp]'));
    const line = block.slice(0, block.indexOf('`,'));
    expect(line).not.toContain('${code}');
  });
});

/**
 * Convex EMBALLE ce qu'une action lève : `throw new Error('RATE_LIMITED')`
 * arrive côté app en « [Request ID: …] … Uncaught Error: RATE_LIMITED at … ».
 * Les écrans comparaient ce message au code par égalité stricte — donc aucun
 * cas ne matchait jamais et tout tombait dans « une erreur est survenue ».
 */
describe('les codes serveur atteignent les écrans', () => {
  const actions = readFileSync('app/[locale]/(auth)/actions.ts', 'utf8');

  it('le code est cherché DANS le message, pas comparé à lui', () => {
    expect(actions).toContain('message.includes(code)');
  });

  it('plus aucun catch ne renvoie le message brut de Convex', () => {
    expect(actions).not.toContain("error: err instanceof Error ? err.message : 'UNKNOWN'");
  });

  it('les codes que les écrans traduisent sont tous reconnus', () => {
    for (const code of [
      'RATE_LIMITED',
      'ACCOUNT_SUSPENDED',
      'WHATSAPP_UNDELIVERABLE',
      'WHATSAPP_SEND_FAILED',
      'INVALID_CODE',
      'TOO_MANY_ATTEMPTS',
    ]) {
      expect(actions, code).toContain(`'${code}'`);
    }
  });

  it("l'écran de connexion sait dire qu'un numéro ne peut pas recevoir le code", () => {
    const form = readFileSync('components/auth/sign-in-form.tsx', 'utf8');
    expect(form).toContain("case 'WHATSAPP_UNDELIVERABLE':");
    expect(form).toContain("t('errors.whatsappUndeliverable')");
  });

  it("l'écran de vérification emploie les noms de codes du serveur", () => {
    // Il attendait `OTP_INVALID` / `OTP_TOO_MANY_ATTEMPTS`, que le serveur ne
    // lève pas : il lève `INVALID_CODE` et `TOO_MANY_ATTEMPTS`.
    const form = readFileSync('components/auth/verify-form.tsx', 'utf8');
    expect(form).toContain("case 'INVALID_CODE':");
    expect(form).toContain("case 'TOO_MANY_ATTEMPTS':");
  });
});

/**
 * Le même refus, sur l'autre écran.
 *
 * `requestLinkPhone` lève `WHATSAPP_UNDELIVERABLE` exactement comme
 * `requestOtp`, mais l'onboarding ne passe pas par les actions serveur : il
 * appelle `/api/account/link/phone/request`, dont la table de codes est
 * distincte. Un code inconnu y devient `UNKNOWN` (HTTP 500) et l'assistant
 * affiche « une erreur est survenue » — le message générique que tout ce
 * fichier cherche à faire disparaître, réapparu sur l'écran où une partenaire
 * saisit son numéro pour la première fois.
 */
describe('le refus définitif atteint aussi l’onboarding', () => {
  const route = readFileSync('app/api/account/link/phone/request/route.ts', 'utf8');
  const wizard = readFileSync('components/onboarding/onboarding-wizard.tsx', 'utf8');

  it('la route traduit le refus au lieu de le laisser tomber en UNKNOWN', () => {
    expect(route).toContain(
      "if (message.includes('WHATSAPP_UNDELIVERABLE')) return 'UNDELIVERABLE'",
    );
  });

  it('le refus est classé avant l’échec générique', () => {
    // `WHATSAPP_SEND_FAILED` est le fourre-tout : s'il était testé en premier
    // sur un message qui porte les deux, le refus définitif serait annoncé
    // comme un incident passager.
    expect(route.indexOf('WHATSAPP_UNDELIVERABLE')).toBeLessThan(
      route.indexOf('WHATSAPP_SEND_FAILED'),
    );
  });

  it('l’assistant a une copie pour ce cas, distincte de l’échec d’envoi', () => {
    expect(wizard).toContain("case 'UNDELIVERABLE':");
    expect(wizard).toContain("t('errors.whatsappUndeliverable')");
  });

  it('la copie existe dans les sept locales', () => {
    for (const loc of ['fr', 'en', 'es', 'de', 'it', 'pt', 'ar']) {
      const messages = JSON.parse(readFileSync(`messages/${loc}.json`, 'utf8'));
      const copy = messages.Onboarding?.errors?.whatsappUndeliverable;
      expect(typeof copy, loc).toBe('string');
      expect(copy.length, loc).toBeGreaterThan(0);
    }
  });
});
