import { describe, expect, it } from 'vitest';
import { sharedCookieDomain } from '../../../lib/subdomain/extract-org-slug';

/**
 * Le cookie d'attribution `wdb_ref` doit survivre au passage d'un sous-domaine
 * d'agence vers l'apex : le lien qu'une partenaire partage pointe son
 * sous-domaine, alors que `/api/checkout` vit sur l'apex. Host-only, le cookie
 * n'y était jamais renvoyé — attribution ET remise perdues sans le moindre
 * signal, et sans qu'aucun test ne le voie.
 */
describe('sharedCookieDomain', () => {
  it('partage le cookie entre un sous-domaine d’agence et l’apex', () => {
    expect(sharedCookieDomain('sarah.wedillybird.com')).toBe('.wedillybird.com');
    expect(sharedCookieDomain('wedillybird.com')).toBe('.wedillybird.com');
    expect(sharedCookieDomain('www.wedillybird.com')).toBe('.wedillybird.com');
  });

  it('normalise le port et la casse', () => {
    expect(sharedCookieDomain('SARAH.WEDILLYBIRD.COM:443')).toBe('.wedillybird.com');
  });

  it('reste host-only sur un suffixe public — un `domain` y serait refusé', () => {
    // `.vercel.app` est sur la Public Suffix List : le navigateur rejetterait
    // le cookie et l'attribution serait perdue sur toutes les previews.
    expect(sharedCookieDomain('wedillybird-git-abc.vercel.app')).toBeNull();
    expect(sharedCookieDomain('vercel.app')).toBeNull();
  });

  it('reste host-only en développement', () => {
    expect(sharedCookieDomain('localhost:3000')).toBeNull();
    expect(sharedCookieDomain('sarah.localhost:3000')).toBeNull();
    expect(sharedCookieDomain('127.0.0.1:3000')).toBeNull();
  });

  it('ne devine jamais un domaine parent sur un host inconnu', () => {
    expect(sharedCookieDomain('exemple.fr')).toBeNull();
    expect(sharedCookieDomain('a.b.exemple.fr')).toBeNull();
    expect(sharedCookieDomain('')).toBeNull();
    expect(sharedCookieDomain(null)).toBeNull();
    expect(sharedCookieDomain(undefined)).toBeNull();
  });
});
