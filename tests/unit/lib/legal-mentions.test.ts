import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { routing } from '../../../i18n/routing';
import { LEGAL_ENTITY, pendingLegalFields } from '../../../lib/legal/entity';

/**
 * Mentions légales — la page est publique et engage l'entreprise.
 *
 * Elle est composée à partir de `lib/legal/entity.ts` (les faits) et des
 * fichiers de messages (les seuls LIBELLÉS). Ce test verrouille cette
 * séparation : le jour où quelqu'un recopie un SIREN dans une locale « pour
 * aller vite », il y a sept endroits à corriger et six occasions d'en oublier
 * un.
 */

const MESSAGES_DIR = path.resolve(__dirname, '../../../messages');

function load(locale: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(MESSAGES_DIR, `${locale}.json`), 'utf-8'));
}

function mentions(locale: string): Record<string, string> {
  const section = (load(locale).Legal as Record<string, Record<string, string> | undefined>)
    .mentions;
  if (!section) throw new Error(`Legal.mentions absent pour la locale ${locale}`);
  return section;
}

describe('Legal.mentions — parité et contenu', () => {
  const fr = mentions('fr');
  const expectedKeys = Object.keys(fr).sort();

  it('chaque locale porte les mêmes clés, non vides', () => {
    for (const locale of routing.locales) {
      const section = mentions(locale);
      expect(section, `${locale}: section absente`).toBeTruthy();
      expect(Object.keys(section).sort(), `${locale}: clés divergentes`).toEqual(expectedKeys);
      for (const [key, value] of Object.entries(section)) {
        expect(typeof value, `${locale}.${key}`).toBe('string');
        expect(value.trim().length, `${locale}.${key} vide`).toBeGreaterThan(0);
      }
    }
  });

  it('les gabarits gardent leurs variables — sinon la valeur ne s’imprime pas', () => {
    const required: Record<string, string[]> = {
      tradeName: ['{value}'],
      capital: ['{value}'],
      siren: ['{value}'],
      siret: ['{value}'],
      rcs: ['{city}', '{value}'],
      vat: ['{value}'],
      contact: ['{value}'],
      directorBody: ['{name}'],
      hostBody: ['{name}', '{url}'],
      mediationBody: ['{name}', '{url}'],
    };
    for (const locale of routing.locales) {
      const section = mentions(locale);
      for (const [key, placeholders] of Object.entries(required)) {
        for (const ph of placeholders) {
          expect(section[key], `${locale}.${key} sans ${ph}`).toContain(ph);
        }
      }
    }
  });

  it('aucune mention n’est un gabarit « à compléter »', () => {
    for (const locale of routing.locales) {
      for (const [key, value] of Object.entries(mentions(locale))) {
        expect(value, `${locale}.${key}`).not.toMatch(/à compléter|to be completed/i);
        // `TODO` en capitales uniquement : « Todo el contenido » est de
        // l'espagnol parfaitement valide, pas un gabarit oublié.
        expect(value, `${locale}.${key}`).not.toMatch(/\bTODO\b/);
      }
    }
  });

  it('les métadonnées de la page existent partout', () => {
    for (const locale of routing.locales) {
      const meta = (load(locale).Metadata as Record<string, Record<string, string>>).legalMentions;
      expect(meta?.title?.trim(), `${locale}: title`).toBeTruthy();
      expect(meta?.description?.trim(), `${locale}: description`).toBeTruthy();
    }
  });

  it('les textes sont traduits, pas recopiés du français', () => {
    for (const locale of routing.locales) {
      if (locale === 'fr') continue;
      expect(mentions(locale).ipBody, `${locale}: ipBody non traduit`).not.toBe(fr.ipBody);
    }
  });
});

describe('identité légale — source unique', () => {
  it('aucun identifiant n’est recopié dans les fichiers de messages', () => {
    // Un SIREN ne se traduit pas. S'il apparaissait dans une locale, il vivrait
    // à huit endroits — et le jour d'un changement d'entité, sept resteraient
    // faux sans que rien ne le signale.
    for (const locale of routing.locales) {
      const raw = fs.readFileSync(path.join(MESSAGES_DIR, `${locale}.json`), 'utf-8');
      expect(raw, `${locale}: SIREN recopié`).not.toContain(LEGAL_ENTITY.siren);
      expect(raw, `${locale}: n° TVA recopié`).not.toContain(LEGAL_ENTITY.vatNumber);
    }
  });

  it('énumère ce qui manque encore pour que la page soit conforme', () => {
    // Tant que cette liste n'est pas vide, la page OMET les lignes concernées.
    // Elle est donc incomplète — mais jamais fausse, ce qui est la seule
    // propriété qu'on puisse tenir sans les données.
    const pending = pendingLegalFields();
    expect(pending).toContain('registeredAddress');
    expect(pending).toContain('publicationDirector');
    // Ce qui EST connu doit l'être vraiment.
    expect(LEGAL_ENTITY.siren).toBe('930817697');
    expect(LEGAL_ENTITY.vatNumber).toBe('FR31930817697');
  });
});
