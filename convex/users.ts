import { v } from 'convex/values';
import { internalQuery, mutation, query } from './_generated/server';
import { isValidEmail } from './lib/email';
import { BUDGET_CURRENCY } from './lib/currency';
import { resolveOnboardingRole } from './lib/onboardingRole';
import { isSuspended } from './lib/accountStatus';

export const completeOnboarding = mutation({
  args: {
    userId: v.id('users'),
    fullName: v.string(),
    // Optionnel : le wizard masque le step « rôle » quand le compte en a déjà
    // un (admin promu, partenaire ayant consommé son invitation).
    role: v.optional(v.union(v.literal('couple'), v.literal('pro'))),
    email: v.string(),
    preferredCurrency: v.optional(BUDGET_CURRENCY),
  },
  handler: async (ctx, { userId, fullName, role, email, preferredCurrency }) => {
    const user = await ctx.db.get(userId);
    if (!user) throw new Error('USER_NOT_FOUND');
    // Un compte suspendu ne repasse pas par l'onboarding : c'était la voie de
    // retour qui rendait la sanction annulable par la personne suspendue.
    if (isSuspended(user)) throw new Error('ACCOUNT_SUSPENDED');

    const trimmed = fullName.trim();
    if (trimmed.length < 2 || trimmed.length > 80) {
      throw new Error('INVALID_NAME');
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (!isValidEmail(normalizedEmail)) {
      throw new Error('INVALID_EMAIL');
    }

    // Strict ownership : si un autre user possède déjà cet email → block.
    // Le user qui s'est connecté via magic link a déjà cet email sur son
    // record (cas légitime), donc on autorise quand existing._id === userId.
    const conflict = await ctx.db
      .query('users')
      .withIndex('by_email', (q) => q.eq('email', normalizedEmail))
      .first();
    if (conflict && conflict._id !== userId) {
      throw new Error('EMAIL_TAKEN');
    }

    // Ne jamais rétrograder : un admin plateforme reste admin, un partenaire
    // déjà passé `pro` via son lien d'invitation reste pro.
    const resolvedRole = resolveOnboardingRole(user.role, role);

    await ctx.db.patch(userId, {
      fullName: trimmed,
      role: resolvedRole,
      email: normalizedEmail,
      ...(preferredCurrency ? { preferredCurrency } : {}),
    });

    return { ok: true as const };
  },
});

export const getById = query({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (!user) return null;
    return {
      _id: user._id,
      phone: user.phone,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
    };
  },
});

/* -------------------------------------------------------------------------- */
/*  Détection de doublons — audit manuel                                      */
/*                                                                            */
/*  Internal query lançable via :                                             */
/*    pnpx convex run users:_scanDuplicates                                   */
/*                                                                            */
/*  Retourne un tableau de paires/triplets de users qui partagent un          */
/*  fullName normalisé identique ET (même email OU même phone normalisé).     */
/*                                                                            */
/*  Heuristique de score :                                                    */
/*    - 100 : email identique                                                 */
/*    -  80 : phone identique normalisé                                       */
/*    -  50 : juste fullName identique                                        */
/*  Seuil de garde : score >= 50 (toute paire partageant fullName).           */
/*                                                                            */
/*  Volontairement read-only : aucune fusion automatique. Le rapport est      */
/*  loggué côté Convex puis retourné au caller. Si des paires sont trouvées,  */
/*  la fusion fait l'objet d'un sprint dédié.                                 */
/* -------------------------------------------------------------------------- */

type ScanDuplicateReason = 'fullName+email' | 'fullName+phone' | 'fullName';

interface DuplicatePair {
  users: Array<{
    _id: string;
    fullName?: string;
    email?: string;
    phone?: string;
    role: string;
    createdAt: number;
  }>;
  score: number;
  reason: ScanDuplicateReason;
}

function normalizeFullName(value: string | undefined): string {
  if (!value) return '';
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizePhoneLoose(value: string | undefined): string {
  if (!value) return '';
  return value.replace(/[^\d+]/g, '');
}

function normalizeEmailLoose(value: string | undefined): string {
  if (!value) return '';
  return value.trim().toLowerCase();
}

export const _scanDuplicates = internalQuery({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query('users').collect();
    const pairs: DuplicatePair[] = [];

    // Groupement initial par fullName normalisé pour réduire la complexité —
    // sans ça on serait en O(n^2) brut sur toute la table users.
    const byFullName = new Map<string, typeof users>();
    for (const user of users) {
      const key = normalizeFullName(user.fullName);
      if (!key) continue;
      const bucket = byFullName.get(key);
      if (bucket) {
        bucket.push(user);
      } else {
        byFullName.set(key, [user]);
      }
    }

    for (const bucket of byFullName.values()) {
      if (bucket.length < 2) continue;

      // Compare chaque paire dans le bucket.
      for (let i = 0; i < bucket.length; i++) {
        for (let j = i + 1; j < bucket.length; j++) {
          const a = bucket[i]!;
          const b = bucket[j]!;

          let score = 50;
          let reason: ScanDuplicateReason = 'fullName';

          const emailA = normalizeEmailLoose(a.email);
          const emailB = normalizeEmailLoose(b.email);
          if (emailA && emailB && emailA === emailB) {
            score = 100;
            reason = 'fullName+email';
          } else {
            const phoneA = normalizePhoneLoose(a.phone);
            const phoneB = normalizePhoneLoose(b.phone);
            if (phoneA && phoneB && phoneA === phoneB) {
              score = 80;
              reason = 'fullName+phone';
            }
          }

          if (score < 50) continue;

          pairs.push({
            users: [a, b].map((u) => ({
              _id: u._id,
              fullName: u.fullName,
              email: u.email,
              phone: u.phone,
              role: u.role,
              createdAt: u.createdAt,
            })),
            score,
            reason,
          });
        }
      }
    }

    // Tri décroissant par score puis par fullName pour une lecture utile
    // dans la console.
    pairs.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (a.users[0]?.fullName ?? '').localeCompare(b.users[0]?.fullName ?? '');
    });

    const top = pairs.slice(0, 50);

    console.log(
      `[users:_scanDuplicates] ${pairs.length} paire(s) suspectes détectées sur ${users.length} users (top 50 retournées) :`,
    );
    for (const pair of top) {
      const left = pair.users[0]!;
      const right = pair.users[1]!;
      // PII retirée des logs (nom/email/téléphone) : on ne garde que les ids +
      // score/raison, suffisants pour investiguer sans exposer de données
      // personnelles dans l'observabilité Convex. Cf. audit archi 2026-07-19.
      console.log(`  - score=${pair.score} reason=${pair.reason} | ${left._id} <> ${right._id}`);
    }

    return {
      totalUsersScanned: users.length,
      totalPairs: pairs.length,
      pairs: top,
    };
  },
});
