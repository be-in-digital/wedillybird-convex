import { describe, expect, it } from 'vitest';
import { matchesRoleFilter } from '@/lib/admin/user-filters';

describe('matchesRoleFilter — vue par défaut', () => {
  it("montre les clients et cache les comptes d'administration", () => {
    expect(matchesRoleFilter('couple', 'all')).toBe(true);
    expect(matchesRoleFilter('pro', 'all')).toBe(true);
    expect(matchesRoleFilter('guest', 'all')).toBe(true);
    expect(matchesRoleFilter('admin', 'all')).toBe(false);
  });
});

describe('matchesRoleFilter — filtre explicite', () => {
  it('ramène les admins quand on les demande', () => {
    // Sortis de la vue, pas des données : sans cette porte, plus aucun écran
    // ne dirait qui détient les droits d'administration.
    expect(matchesRoleFilter('admin', 'admin')).toBe(true);
    expect(matchesRoleFilter('couple', 'admin')).toBe(false);
  });

  it('reste exact sur les autres rôles', () => {
    expect(matchesRoleFilter('pro', 'pro')).toBe(true);
    expect(matchesRoleFilter('couple', 'pro')).toBe(false);
    expect(matchesRoleFilter('guest', 'guest')).toBe(true);
  });
});
