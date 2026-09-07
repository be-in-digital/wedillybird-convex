/**
 * Génération de slug unique sur une table indexée.
 *
 * Au lieu de dupliquer dans `events.ts` et `organizations.ts` une boucle
 * « try base, then base-XXXX, then throw », on isole la mécanique ici.
 *
 * Convex ne typant pas dynamiquement `db.query(tableName).withIndex(indexName, …)`
 * via des génériques (les noms d'index sont attachés à la table via le builder
 * du schema), on assume des casts `as never` ciblés au point d'appel — c'est
 * volontaire et beaucoup plus lisible que les doubles casts `as unknown as { … }`
 * qu'on avait avant.
 */

import type { MutationCtx } from '../_generated/server';
import type { TableNames } from '../_generated/dataModel';

const DEFAULT_MAX_ATTEMPTS = 10;

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6);
}

/**
 * Cherche un slug libre sur une table donnée.
 *
 * @param ctx          MutationCtx Convex
 * @param tableName    Nom de la table à interroger (ex. `'events'`)
 * @param indexName    Index à utiliser (doit être de la forme `by_<field>`)
 * @param slugField    Champ indexé sur lequel comparer (ex. `'slug'`)
 * @param base         Slug initial à essayer
 * @param maxAttempts  Nombre maximum d'essais (défaut: 10)
 *
 * @returns Le slug libre trouvé.
 * @throws  `SLUG_GENERATION_FAILED` si aucun slug n'est libre après `maxAttempts`.
 */
export async function pickUniqueSlug<T extends TableNames>(
  ctx: MutationCtx,
  tableName: T,
  indexName: string,
  slugField: string,
  base: string,
  maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    const candidate = i === 0 ? base : `${base}-${randomSuffix()}`;
    // Convex doesn't expose dynamic table names through generic helpers —
    // narrow at call site via `as never` rather than reconstructing the
    // index/query type by hand (which is what the duplicated implementations
    // were doing with double `as unknown as { withIndex: ... }` casts).
    const existing = await ctx.db
      .query(tableName)
      .withIndex(
        indexName as never,
        ((q: { eq: (k: string, v: string) => unknown }) => q.eq(slugField, candidate)) as never,
      )
      .first();
    if (!existing) return candidate;
  }
  throw new Error('SLUG_GENERATION_FAILED');
}

/**
 * Slug d'organisation. Partagé par la création classique (`organizations.create`)
 * et par l'acceptation d'un lien partenaire : deux agences nommées pareil
 * doivent produire le même slug de base, sinon `pickUniqueSlug` ne peut pas
 * jouer son rôle de départage.
 */
export function slugifyOrgName(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}
