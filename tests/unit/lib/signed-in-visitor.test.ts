import { describe, expect, it } from 'vitest';
import { redirectForSignedInVisitor } from '@/lib/auth/signed-in-visitor';

describe('redirectForSignedInVisitor', () => {
  it('rend le formulaire quand il n’y a pas de session', () => {
    expect(redirectForSignedInVisitor({ hasSession: false })).toBeNull();
    expect(redirectForSignedInVisitor({ hasSession: false, next: '/rejoindre/abc' })).toBeNull();
  });

  it('renvoie vers /dashboard un visiteur déjà connecté', () => {
    expect(redirectForSignedInVisitor({ hasSession: true })).toBe('/dashboard');
  });

  it('préfère `next` — c’est lui qui porte l’invitation d’une partenaire', () => {
    // Sans ça, une partenaire déjà connectée qui repasse par /sign-in perdrait
    // son lien d'invitation et donc son organisation offerte.
    expect(redirectForSignedInVisitor({ hasSession: true, next: '/rejoindre/abc' })).toBe(
      '/rejoindre/abc',
    );
    expect(redirectForSignedInVisitor({ hasSession: true, next: '/pro/invite/tok' })).toBe(
      '/pro/invite/tok',
    );
  });

  it('laisse la page en place quand la query porte une erreur', () => {
    // `/sign-in?error=expired` est l'atterrissage d'un lien magique mort :
    // rediriger effacerait la seule explication de l'échec.
    expect(redirectForSignedInVisitor({ hasSession: true, error: 'expired' })).toBeNull();
    expect(
      redirectForSignedInVisitor({
        hasSession: true,
        next: '/rejoindre/abc',
        error: 'invalid_token',
      }),
    ).toBeNull();
  });

  it('ignore une erreur vide (query présente mais sans valeur)', () => {
    expect(redirectForSignedInVisitor({ hasSession: true, error: '' })).toBe('/dashboard');
  });
});
