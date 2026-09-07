import { describe, expect, it } from 'vitest';
import { safeNextPath } from '@/lib/auth/safe-next';

describe('safeNextPath — ce qui est accepte', () => {
  it('accepte un chemin interne, avec query et fragment', () => {
    expect(safeNextPath('/rejoindre/K7QMXJ4PR2NBVHTC9YDF')).toBe('/rejoindre/K7QMXJ4PR2NBVHTC9YDF');
    expect(safeNextPath('/fr/rejoindre/ABC?src=mail')).toBe('/fr/rejoindre/ABC?src=mail');
    expect(safeNextPath('/events/e1#upgrade')).toBe('/events/e1#upgrade');
  });
});

describe('safeNextPath — redirection ouverte', () => {
  it('refuse une URL absolue', () => {
    for (const bad of [
      'https://evil.tld',
      'http://evil.tld/x',
      'javascript:alert(1)',
      'data:text/html,x',
    ]) {
      expect(safeNextPath(bad)).toBeNull();
    }
  });

  it('refuse les formes protocol-relative, qui sortent du site malgre le / initial', () => {
    expect(safeNextPath('//evil.tld')).toBeNull();
    expect(safeNextPath('//evil.tld/path')).toBeNull();
    expect(safeNextPath('/\\evil.tld')).toBeNull();
  });

  it('refuse un schema deguise apres le slash initial', () => {
    expect(safeNextPath('/javascript:alert(1)')).toBeNull();
    expect(safeNextPath('/https://evil.tld')).toBeNull();
  });

  it('refuse les encodages qui redeviennent une sortie de site', () => {
    expect(safeNextPath('/%2f%2fevil.tld')).toBeNull();
    expect(safeNextPath('/%5cevil.tld')).toBeNull();
  });

  it('refuse les caracteres de controle (injection d en-tete Location)', () => {
    expect(safeNextPath('/ok\r\nLocation: https://evil.tld')).toBeNull();
    expect(safeNextPath('/ok\u0000')).toBeNull();
  });
});

describe('safeNextPath — entrees vides ou absurdes', () => {
  it('renvoie null plutot que de deviner', () => {
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath('')).toBeNull();
    expect(safeNextPath('   ')).toBeNull();
    expect(safeNextPath('dashboard')).toBeNull();
    expect(safeNextPath('/' + 'a'.repeat(600))).toBeNull();
  });
});
