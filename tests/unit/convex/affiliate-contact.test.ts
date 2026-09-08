import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { isValidEmail } from '../../../convex/lib/email';

const BOARD = readFileSync('components/admin/admin-affiliates-board.tsx', 'utf8');
const CONVEX = readFileSync('convex/affiliate.ts', 'utf8');
const ACTIONS = readFileSync('app/[locale]/(app)/admin/actions.ts', 'utf8');

/**
 * `ownerEmail` ne s'écrivait qu'à la création de l'affilié. Un partenaire créé
 * sans adresse — ou avec une faute — n'avait donc aucune issue : « Envoyer par
 * e-mail » restait grisé pour toujours, et la seule sortie était de supprimer
 * l'affilié, donc son code, ses commissions et son historique.
 */
describe('le contact d’un affilié est corrigible', () => {
  const fn = CONVEX.slice(CONVEX.indexOf('export const setAffiliateContact'));
  const body = fn.slice(0, fn.indexOf('\n});'));

  it('la mutation existe et est réservée aux admins', () => {
    expect(body).toContain('await assertAdmin(ctx, adminId)');
  });

  it('elle refuse une adresse invalide plutôt que de la stocker', () => {
    // Une adresse mal saisie stockée en base, c'est un envoi qui échoue plus
    // tard sans que rien n'ait prévenu à la saisie.
    expect(body).toContain(
      "if (email !== null && !isValidEmail(email)) throw new Error('INVALID_EMAIL')",
    );
    expect(isValidEmail('sarah@exemple.com')).toBe(true);
    expect(isValidEmail('sarah')).toBe(false);
  });

  it('elle normalise comme à la création', () => {
    // Sans ça, une adresse stockée avec une majuscule partirait quand même mais
    // ne s'égaliserait plus à elle-même dans les comparaisons.
    expect(body).toContain('ownerEmail?.trim().toLowerCase()');
  });

  it("elle journalise l'adresse : c'est elle qui décide où part un compte offert", () => {
    expect(body).toContain("action: 'set_affiliate_contact'");
    expect(body).toContain('ownerEmail: email');
  });

  it('elle reste distincte du rattachement de COMPTE', () => {
    // `setAffiliateOwner` attache un utilisateur et ouvre /partenaire ; deviner
    // l'un depuis l'autre donnerait à quelqu'un les commissions d'un autre.
    expect(body).not.toContain('ownerUserId');
  });

  it('elle est câblée jusqu’à l’écran', () => {
    expect(ACTIONS).toContain('export async function adminSetAffiliateContactAction');
    expect(BOARD).toContain('adminSetAffiliateContactAction');
  });
});

/**
 * La cellule n'affichait que `displayName ?? ownerEmail`. Un affilié nommé mais
 * sans adresse paraissait donc renseigné, pendant que le bouton d'envoi restait
 * grisé : le tableau disait le contraire du bouton.
 */
describe('la cellule Contact ne masque plus une adresse manquante', () => {
  it("n'affiche plus l'un À LA PLACE de l'autre", () => {
    expect(BOARD).not.toContain("{a.displayName ?? a.ownerEmail ?? '—'}");
  });

  it("nomme l'absence d'adresse, qui est ce qui bloque l'envoi", () => {
    // Insensible à la casse : ce qui doit tenir, c'est que la cellule NOMME le
    // manque — pas qu'elle l'écrive en minuscules. Épingler la typographie
    // ferait échouer le test au moindre passage en capitale initiale.
    expect(BOARD.toLowerCase()).toContain('aucune adresse');
  });

  it('la condition du bouton d’envoi porte bien sur cette adresse', () => {
    // Le lien entre les deux : la cellule doit parler du champ que le bouton lit.
    expect(BOARD).toContain('const recipient = invite?.inviteeEmail ?? fallbackEmail;');
    expect(BOARD).toContain('disabled={pending || !recipient}');
  });
});
