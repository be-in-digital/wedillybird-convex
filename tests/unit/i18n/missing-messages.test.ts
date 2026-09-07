import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { routing } from '../../../i18n/routing';

/**
 * Garde-fou contre les clés i18n absentes.
 *
 * next-intl n'échoue pas sur une clé manquante : il **imprime le chemin de la
 * clé**. Une page part donc en production en affichant « BugReport.cta » ou
 * « Admin.nav.affiliates » à l'utilisateur, sans qu'aucun test ne bronche —
 * la validation de parité (`pnpm i18n:validate`) ne compare que les locales
 * ENTRE ELLES : sept fichiers identiquement incomplets passent.
 *
 * Ces deux vérifications comblent l'angle mort en croisant les messages avec
 * le CODE qui les demande.
 */

const ROOT = path.resolve(__dirname, '../../..');
const MESSAGES_DIR = path.join(ROOT, 'messages');
const SHELL = path.join(ROOT, 'components/admin/admin-shell.tsx');

/**
 * Dette connue au 7 septembre 2026 : namespaces demandés par du code existant
 * mais absents des messages. Ces écrans affichent aujourd'hui des clés brutes.
 * La liste est là pour que la dette soit COMPTÉE plutôt qu'oubliée — et pour
 * qu'aucun NOUVEAU namespace ne puisse s'y ajouter en silence. Elle doit
 * rétrécir, jamais grandir.
 */
const KNOWN_MISSING = new Set([
  'CeremonySchedule', // éditeur d'horaires de cérémonie (~55 clés)
  'MonMariage.nav',
  'MonMariage.home.referral', // carte de parrainage de l'espace couple
  'Upgrade.upsell',
  'Upgrade.upsell.photoBook',
]);

function messagesFor(locale: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(MESSAGES_DIR, `${locale}.json`), 'utf-8'));
}

function lookup(root: Record<string, unknown>, dotted: string): unknown {
  return dotted
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
      root,
    );
}

/** Fichiers source de l'app, hors dépendances et artefacts de build. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
  };
  for (const dir of ['app', 'components', 'lib']) walk(path.join(ROOT, dir));
  return out;
}

/** Namespaces passés en littéral à `useTranslations` / `getTranslations`. */
function requestedNamespaces(): string[] {
  const re = /(?:useTranslations|getTranslations)\(\s*'([A-Za-z][A-Za-z0-9_.]*)'/g;
  const found = new Set<string>();
  for (const file of sourceFiles()) {
    const source = fs.readFileSync(file, 'utf-8');
    for (const m of source.matchAll(re)) found.add(m[1]!);
  }
  return [...found].sort();
}

describe('namespaces i18n demandés par le code', () => {
  const namespaces = requestedNamespaces();

  it('le scan trouve bien les namespaces (garde-fou du garde-fou)', () => {
    expect(namespaces.length).toBeGreaterThan(50);
    expect(namespaces).toContain('BugReport');
  });

  it('chaque namespace existe dans les sept locales', () => {
    for (const locale of routing.locales) {
      const messages = messagesFor(locale);
      const missing = namespaces.filter(
        (ns) => !KNOWN_MISSING.has(ns) && lookup(messages, ns) === undefined,
      );
      expect(missing, `${locale}: namespaces absents des messages`).toEqual([]);
    }
  });

  it('la dette connue ne grandit pas — et se réduit quand elle est comblée', () => {
    // Un namespace comblé doit sortir de la liste : sinon elle finit par
    // décrire un état qui n'existe plus, et ne protège plus de rien.
    const fr = messagesFor('fr');
    const stillMissing = [...KNOWN_MISSING].filter((ns) => lookup(fr, ns) === undefined);
    expect([...KNOWN_MISSING].sort()).toEqual(stillMissing.sort());
  });
});

describe('navigation admin — chaque entrée a son libellé', () => {
  const keys = [
    ...new Set(
      [...fs.readFileSync(SHELL, 'utf-8').matchAll(/labelKey:\s*'([^']+)'/g)].map((m) => m[1]!),
    ),
  ];

  it('la table de navigation est bien lue', () => {
    expect(keys.length).toBeGreaterThan(5);
    expect(keys).toContain('nav.affiliates');
  });

  it('chaque libellé existe, non vide, dans les sept locales', () => {
    for (const locale of routing.locales) {
      const admin = messagesFor(locale).Admin as Record<string, unknown>;
      for (const key of keys) {
        const value = lookup(admin, key);
        expect(typeof value, `${locale}: Admin.${key} manquant`).toBe('string');
        expect((value as string).trim().length, `${locale}: Admin.${key} vide`).toBeGreaterThan(0);
      }
    }
  });
});
