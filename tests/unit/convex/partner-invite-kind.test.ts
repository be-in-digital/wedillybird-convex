import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_PARTNER_COMP_EVENT_TIER,
  DEFAULT_PARTNER_COMP_TIER,
  inviteKind,
} from '../../../convex/lib/partnerInvite';

describe("type d'invitation partenaire", () => {
  it('les liens créés avant ce champ restent des liens agence', () => {
    // Rétro-compatibilité : `kind` est optionnel en base. Le lire comme
    // « couple » par défaut aurait transformé les invitations déjà envoyées.
    expect(inviteKind({})).toBe('pro');
    expect(inviteKind({ kind: null })).toBe('pro');
  });

  it('respecte le type explicite', () => {
    expect(inviteKind({ kind: 'pro' })).toBe('pro');
    expect(inviteKind({ kind: 'couple' })).toBe('couple');
  });
});

describe('ce que chaque type offre', () => {
  it("l'agence reçoit un abonnement, le particulier un forfait d'événement", () => {
    // Deux modèles économiques, deux cadeaux : un abonnement court dans le
    // temps, un forfait particulier s'achète une fois pour un mariage.
    expect(DEFAULT_PARTNER_COMP_TIER).toBe('starter');
    expect(DEFAULT_PARTNER_COMP_EVENT_TIER).toBe('premium');
  });
});

describe('redeem — la branche couple', () => {
  const src = readFileSync('convex/partnerInvites.ts', 'utf8');
  const branch = src.slice(
    src.indexOf("if (inviteKind(invite) === 'couple')"),
    src.indexOf("const name = (organizationName ?? '').trim()"),
  );

  it('ne promeut PAS le rôle', () => {
    // Promouvoir en `pro` ouvrirait un back-office d'agence à quelqu'un venu
    // organiser son propre mariage.
    expect(branch).not.toContain("role: 'pro'");
    expect(branch).not.toContain('role:');
  });

  it("ne crée pas d'organisation", () => {
    expect(branch).not.toContain("insert('organizations'");
    expect(branch).toContain('organizationId: null');
  });

  it("pose la créance sur le compte plutôt qu'un abonnement", () => {
    expect(branch).toContain('compedEventPlan');
    expect(branch).not.toContain('compedSubscription');
  });

  it('rattache quand même le code partenaire', () => {
    // C'est la seconde moitié du deal : sans `ownerUserId`, la personne a un
    // code qui rapporte et aucune page pour le constater.
    expect(branch).toContain('ownerUserId: userId');
  });
});

describe('consommation du forfait offert à la création du mariage', () => {
  const src = readFileSync('convex/events.ts', 'utf8');

  it("ne brûle pas la créance sur un mariage d'agence", () => {
    // Un mariage d'agence est déjà couvert : y consommer le cadeau le ferait
    // disparaître sans rien donner.
    expect(src).toContain(
      'const comped = !args.organizationId ? owner.compedEventPlan : undefined;',
    );
  });

  it('ouvre les mêmes droits que le chemin payant', () => {
    expect(src).toContain('galleryExpiresAt: galleryExpiresAtFor(comped.tier, args.eventDate)');
    expect(src).toContain('paidAt: now');
  });

  it('est à usage unique', () => {
    expect(src).toContain('compedEventPlan: undefined');
  });
});
