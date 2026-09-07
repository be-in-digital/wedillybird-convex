import { describe, expect, it } from 'vitest';
import { isSuspended } from '../../../convex/lib/accountStatus';
import { resolveOnboardingRole } from '../../../convex/lib/onboardingRole';

describe('isSuspended', () => {
  it("ne considère suspendu qu'un compte portant une date", () => {
    expect(isSuspended({ suspendedAt: 1_700_000_000_000 })).toBe(true);
    expect(isSuspended({})).toBe(false);
    expect(isSuspended({ suspendedAt: null })).toBe(false);
    expect(isSuspended(null)).toBe(false);
    expect(isSuspended(undefined)).toBe(false);
  });

  it('traite 0 comme une date, pas comme une absence', () => {
    // `suspendedAt: 0` est une date (epoch) : un test de véracité l'aurait
    // considérée comme « pas suspendu ».
    expect(isSuspended({ suspendedAt: 0 })).toBe(true);
  });
});

describe('la suspension ne passe plus par le rôle', () => {
  it('un compte suspendu garde son rôle, donc rien à redeviner à la réactivation', () => {
    // Avant : suspendre écrivait `role: 'guest'`, le rôle d'origine était perdu.
    // Désormais le rôle est intact et `suspendedAt` porte la sanction.
    const pro = { role: 'pro' as const, suspendedAt: 1_700_000_000_000 };
    expect(isSuspended(pro)).toBe(true);
    expect(pro.role).toBe('pro');
  });

  it("la boucle de contournement par l'onboarding est fermée en amont", () => {
    // Le contournement : suspendre → rôle `guest` → l'onboarding accepte les
    // `guest` → la personne choisit « agence » → elle est de nouveau `pro`.
    // Ce dernier maillon existe toujours pour un vrai nouveau compte…
    expect(resolveOnboardingRole('guest', 'pro')).toBe('pro');
    // …mais il n'est plus atteignable : le rôle n'est plus dégradé à `guest`,
    // et `completeOnboarding` refuse un compte suspendu (ACCOUNT_SUSPENDED).
    expect(resolveOnboardingRole('pro', 'couple')).toBe('pro');
  });
});
