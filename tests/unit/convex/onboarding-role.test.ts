import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  isSettledRole,
  resolveOnboardingRole,
  type StoredRole,
} from '../../../convex/lib/onboardingRole';
import * as appMirror from '../../../lib/auth/onboarding-role';

describe('resolveOnboardingRole — anti-rétrogradation', () => {
  it('un compte neuf prend le rôle choisi', () => {
    expect(resolveOnboardingRole(undefined, 'couple')).toBe('couple');
    expect(resolveOnboardingRole(null, 'pro')).toBe('pro');
    expect(resolveOnboardingRole('guest', 'couple')).toBe('couple');
    expect(resolveOnboardingRole('guest', 'pro')).toBe('pro');
  });

  it("n'abaisse jamais un admin plateforme", () => {
    // Le bug d'origine : l'admin promu par ADMIN_PHONE arrivait sur le wizard
    // sans `fullName`, et le terminer le repassait couple/pro.
    expect(resolveOnboardingRole('admin', 'couple')).toBe('admin');
    expect(resolveOnboardingRole('admin', 'pro')).toBe('admin');
    expect(resolveOnboardingRole('admin', undefined)).toBe('admin');
  });

  it("n'abaisse jamais un partenaire déjà passé pro", () => {
    // Sarah consomme /rejoindre/[token] avant de remplir son profil : elle est
    // `pro` avec son organisation et ses 6 mois offerts. Choisir « couple » au
    // wizard la décrochait de tout.
    expect(resolveOnboardingRole('pro', 'couple')).toBe('pro');
    expect(resolveOnboardingRole('pro', undefined)).toBe('pro');
  });

  it('autorise encore la montée couple → pro', () => {
    expect(resolveOnboardingRole('couple', 'pro')).toBe('pro');
  });

  it('conserve le rôle courant quand le step est masqué', () => {
    const roles: StoredRole[] = ['guest', 'couple', 'pro', 'admin'];
    for (const role of roles) {
      expect(resolveOnboardingRole(role, undefined)).toBe(role);
      expect(resolveOnboardingRole(role, null)).toBe(role);
    }
  });

  it("retombe sur guest quand rien n'est connu", () => {
    expect(resolveOnboardingRole(undefined, undefined)).toBe('guest');
  });
});

describe('isSettledRole', () => {
  it('guest et absence de rôle ne sont pas établis', () => {
    expect(isSettledRole('guest')).toBe(false);
    expect(isSettledRole(null)).toBe(false);
    expect(isSettledRole(undefined)).toBe(false);
  });

  it('couple, pro et admin sont établis → le wizard masque le step rôle', () => {
    expect(isSettledRole('couple')).toBe(true);
    expect(isSettledRole('pro')).toBe(true);
    expect(isSettledRole('admin')).toBe(true);
  });
});

describe('miroir applicatif', () => {
  // Le bundler Convex ne suit pas les imports de `lib/` : le helper est
  // dupliqué. On vérifie que les deux copies ne divergent pas.
  it('lib/auth/onboarding-role.ts se comporte comme la copie Convex', () => {
    const roles: Array<StoredRole | null | undefined> = [
      undefined,
      null,
      'guest',
      'couple',
      'pro',
      'admin',
    ];
    const choices: Array<'couple' | 'pro' | undefined> = ['couple', 'pro', undefined];
    for (const current of roles) {
      expect(appMirror.isSettledRole(current ?? null)).toBe(isSettledRole(current ?? null));
      for (const chosen of choices) {
        expect(appMirror.resolveOnboardingRole(current, chosen)).toBe(
          resolveOnboardingRole(current, chosen),
        );
      }
    }
  });

  it('les deux fichiers ont le même corps de fonction', () => {
    const strip = (path: string) =>
      readFileSync(resolve(process.cwd(), path), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .trim();
    expect(strip('lib/auth/onboarding-role.ts')).toBe(strip('convex/lib/onboardingRole.ts'));
  });
});
