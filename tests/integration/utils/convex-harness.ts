/**
 * Harnais d'intégration Convex — exécute les VRAIES fonctions Convex.
 *
 * `convex-test` monte une implémentation en mémoire du backend : le schéma est
 * appliqué (validateurs compris), les index fonctionnent, et `t.mutation` /
 * `t.query` exécutent le code de `convex/**` tel qu'il tourne en production.
 * C'est la seule façon, sans déploiement, de vérifier un enchaînement de
 * mutations — là où les tests unitaires ne voient que des fonctions pures.
 *
 * Ce que ça NE couvre pas : les actions Node (`'use node'` — SES, WhatsApp,
 * Stripe), qui restent testées par ailleurs avec des doubles.
 */
import { convexTest } from 'convex-test';
import schema from '../../../convex/schema';
import type { Id } from '../../../convex/_generated/dataModel';

/**
 * `import.meta.glob` est fourni par Vite (le transformeur de Vitest) et n'est
 * donc pas dans les types de `ImportMeta` que voit `tsc`. On le déclare ici
 * plutôt que d'ajouter `vite/client` aux types du projet — ce fichier est le
 * seul à s'en servir.
 */
declare global {
  interface ImportMeta {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
}

/**
 * Le glob DOIT être écrit littéralement ici : Vite le réécrit statiquement,
 * une variable ne marcherait pas.
 */
const modules = import.meta.glob('../../../convex/**/*.*s');

/** Indirection volontaire : elle préserve l'inférence du DataModel depuis le
 *  schéma (`ReturnType<typeof convexTest>` seul retomberait sur le modèle
 *  générique, et `ctx.db.query('affiliateReferrals')` perdrait ses index). */
function makeHarness() {
  return convexTest(schema, modules);
}

export type Harness = ReturnType<typeof makeHarness>;

/** Secret partagé attendu par `markSucceeded` — posé pour toute la suite. */
export const WEBHOOK_SECRET = 'test-webhook-secret';

export function newHarness(): Harness {
  process.env.CONVEX_WEBHOOK_SECRET = WEBHOOK_SECRET;
  return makeHarness();
}

interface SeedUser {
  phone?: string;
  email?: string;
  fullName?: string;
  role?: 'couple' | 'pro' | 'guest' | 'admin';
  locale?: 'fr' | 'en' | 'es' | 'it' | 'pt' | 'de' | 'ar';
}

/** Insère un utilisateur minimal valide au regard du schéma. */
export async function seedUser(t: Harness, u: SeedUser = {}): Promise<Id<'users'>> {
  return t.run(async (ctx) =>
    ctx.db.insert('users', {
      ...(u.phone ? { phone: u.phone } : {}),
      ...(u.email ? { email: u.email } : {}),
      ...(u.fullName ? { fullName: u.fullName } : {}),
      locale: u.locale ?? 'fr',
      role: u.role ?? 'couple',
      createdAt: Date.now(),
    }),
  );
}

export async function seedAdmin(t: Harness, phone = '+33600000001'): Promise<Id<'users'>> {
  return seedUser(t, { phone, role: 'admin', fullName: 'Admin' });
}

/** Mariage minimal valide, possédé par `ownerId`. */
export async function seedEvent(
  t: Harness,
  ownerId: Id<'users'>,
  opts: { eventDate?: number; slug?: string } = {},
): Promise<Id<'events'>> {
  const now = Date.now();
  return t.run(async (ctx) =>
    ctx.db.insert('events', {
      ownerId,
      slug: opts.slug ?? `mariage-${Math.random().toString(36).slice(2, 10)}`,
      title: 'Mariage test',
      coupleNames: { partnerA: 'Alice', partnerB: 'Bob' },
      eventDate: opts.eventDate ?? now + 90 * 24 * 60 * 60 * 1000,
      timezone: 'Europe/Paris',
      status: 'active',
      maxGuests: 5000,
      createdAt: now,
      updatedAt: now,
    }),
  );
}

/**
 * Checkout `pending` prêt à être confirmé par `markSucceeded`.
 *
 * `affiliateId` posé = attribution par le LIEN `?ref=` (le cookie a été lu à la
 * création du checkout). Laissé vide, l'attribution ne peut venir que du code
 * promo tapé, passé à `markSucceeded` — les deux chemins du programme.
 */
export async function seedPendingPayment(
  t: Harness,
  input: {
    userId: Id<'users'>;
    eventId: Id<'events'>;
    amountMinor: number;
    sessionId: string;
    affiliateId?: Id<'affiliates'>;
    plan?: 'essential' | 'premium';
    currency?: 'EUR' | 'USD' | 'MAD';
  },
): Promise<Id<'payments'>> {
  const now = Date.now();
  return t.run(async (ctx) =>
    ctx.db.insert('payments', {
      userId: input.userId,
      eventId: input.eventId,
      kind: 'plan',
      plan: input.plan ?? 'premium',
      currency: input.currency ?? 'EUR',
      amountMinor: input.amountMinor,
      provider: 'stripe',
      providerSessionId: input.sessionId,
      ...(input.affiliateId ? { affiliateId: input.affiliateId } : {}),
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    }),
  );
}
