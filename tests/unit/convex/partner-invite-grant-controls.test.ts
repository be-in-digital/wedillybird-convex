import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_PARTNER_COMP_EVENT_TIER,
  DEFAULT_PARTNER_COMP_MONTHS,
  DEFAULT_PARTNER_COMP_TIER,
} from '../../../convex/lib/partnerInvite';

const BOARD = 'components/admin/admin-affiliates-board.tsx';
const board = readFileSync(BOARD, 'utf8');

/**
 * L'écran Affiliés laisse maintenant choisir ce qu'un lien offre. Le piège de
 * cette catégorie de contrôle est de recopier les défauts côté client : ils
 * dérivent, et l'écran finit par annoncer autre chose que ce que le serveur
 * accorde — exactement le genre de mensonge qu'on vient de chasser du cockpit.
 */
describe('les menus pré-remplissent les défauts SERVEUR', () => {
  it('le palier agence pré-sélectionné est celui du serveur', () => {
    expect(board).toContain(`const DEFAULT_TIER = '${DEFAULT_PARTNER_COMP_TIER}' as const;`);
  });

  it('la durée pré-sélectionnée est celle du serveur', () => {
    expect(board).toContain(`const DEFAULT_MONTHS = ${DEFAULT_PARTNER_COMP_MONTHS};`);
  });

  it('le forfait particulier pré-sélectionné est celui du serveur', () => {
    expect(board).toContain(
      `const DEFAULT_EVENT_TIER = '${DEFAULT_PARTNER_COMP_EVENT_TIER}' as const;`,
    );
  });

  it('la durée proposée fait partie des valeurs offertes', () => {
    // Un défaut absent du menu s'afficherait vide, et le premier choix de
    // l'admin changerait silencieusement l'offre.
    const options = board.slice(board.indexOf('const MONTHS_OPTIONS'));
    expect(options.slice(0, options.indexOf(']'))).toContain(String(DEFAULT_PARTNER_COMP_MONTHS));
  });
});

describe('bornes acceptées par le serveur', () => {
  const convex = readFileSync('convex/partnerInvites.ts', 'utf8');

  it('toutes les durées proposées passent la validation', () => {
    // Le serveur exige un entier entre 1 et 24 : proposer 36 mois donnerait un
    // INVALID_GRANT_MONTHS après coup, sur un écran qui l'offrait.
    expect(convex).toContain('grantMonths < 1 || grantMonths > 24');
    const list = board.slice(board.indexOf('const MONTHS_OPTIONS'));
    const values = (list.slice(0, list.indexOf(']')).match(/\d+/g) ?? []).map(Number);
    expect(values.length).toBeGreaterThan(0);
    for (const m of values) {
      expect(Number.isInteger(m) && m >= 1 && m <= 24, `${m} mois`).toBe(true);
    }
  });
});

describe("l'écran dit ce que le lien offre vraiment", () => {
  it('le palier particulier vient du lien, pas d’un Premium supposé', () => {
    // Il était écrit en dur « mariage Premium offert » — faux dès qu'on peut
    // choisir Essentiel.
    expect(board).not.toContain("'personnel · mariage Premium offert'");
    expect(board).toContain('invite.grantEventTier');
  });

  it('la query admin expose bien ce palier', () => {
    const convex = readFileSync('convex/partnerInvites.ts', 'utf8');
    const fn = convex.slice(convex.indexOf('export const listForAdmin'));
    expect(fn.slice(0, fn.indexOf('\n});'))).toContain('grantEventTier:');
  });
});

describe('le choix atteint le serveur', () => {
  const actions = readFileSync('app/[locale]/(app)/admin/actions.ts', 'utf8');
  const fn = actions.slice(actions.indexOf('export async function adminCreatePartnerInviteAction'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));

  it('les trois réglages sont transmis à la mutation', () => {
    for (const field of ['grantTier', 'grantMonths', 'grantEventTier']) {
      expect(body, field).toContain(`${field}: input.${field}`);
    }
  });

  it("un champ non fourni n'est pas transmis — le serveur garde ses défauts", () => {
    // `...(x ? { x } : {})` : sans cette forme, l'app deviendrait une seconde
    // source de vérité pour les défauts.
    expect(body).toContain('...(input?.grantTier ? { grantTier: input.grantTier } : {})');
    expect(body).toContain('...(input?.grantMonths ? { grantMonths: input.grantMonths } : {})');
  });
});
