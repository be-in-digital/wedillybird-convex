import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { Id } from './_generated/dataModel';
import {
  DEFAULT_PARTNER_COMP_MONTHS,
  DEFAULT_PARTNER_COMP_TIER,
  PARTNER_INVITE_VALIDITY_DAYS,
  compExpiresAt,
  inviteExpiresAt,
  inviteState,
} from './lib/partnerInvite';
import { pickUniqueSlug, slugifyOrgName } from './lib/uniqueSlug';

/**
 * Liens d'invitation partenaire — « voici ton compte, six mois offerts ».
 *
 * Le parcours qu'ils remplacent : une partenaire s'inscrit, nomme son agence,
 * arrive sur le dashboard, et `orgHasActiveAccess` lui renvoie `false` faute
 * d'abonnement. Créer un mariage lève `SUBSCRIPTION_REQUIRED`. Elle ne peut
 * littéralement rien voir avant d'avoir choisi et payé un forfait — le pire
 * moment pour demander une carte bancaire à quelqu'un qu'on veut convaincre.
 *
 * `redeem` fait donc tout d'un coup, en UNE mutation : promotion du compte en
 * pro, création de l'organisation, pose du cadeau, rattachement de l'affilié,
 * consommation du jeton. En plusieurs mutations, une panne au milieu laisserait
 * une organisation sans cadeau (elle voit le mur) ou un jeton consommé sans
 * organisation (le lien est brûlé) — deux états dont on ne se relève pas sans
 * intervention manuelle.
 */

const GRANT_TIER = v.union(v.literal('starter'), v.literal('business'), v.literal('agency'));

const INVITE_TOKEN_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const INVITE_TOKEN_LENGTH = 24;

async function assertAdmin(
  ctx: { db: { get: (id: Id<'users'>) => Promise<{ role: string } | null> } },
  adminId: Id<'users'>,
) {
  const user = await ctx.db.get(adminId);
  if (!user || user.role !== 'admin') throw new Error('FORBIDDEN: admin role required');
  return user;
}

/**
 * Jeton opaque. Un lien devinable donnerait un compte agence gratuit à qui
 * saurait compter : `crypto.getRandomValues` sur 24 caractères d'un alphabet
 * sans ambiguïté visuelle (ni O/0 ni I/L/1, le lien se lit au téléphone).
 */
function generateToken(): string {
  const buffer = new Uint8Array(INVITE_TOKEN_LENGTH);
  crypto.getRandomValues(buffer);
  let token = '';
  for (const b of buffer) token += INVITE_TOKEN_ALPHABET[b % INVITE_TOKEN_ALPHABET.length];
  return token;
}

/* -------------------------------------------------------------------------- */
/*  Admin                                                                      */
/* -------------------------------------------------------------------------- */

export const create = mutation({
  args: {
    adminId: v.id('users'),
    affiliateId: v.id('affiliates'),
    inviteeEmail: v.optional(v.string()),
    inviteeName: v.optional(v.string()),
    grantTier: v.optional(GRANT_TIER),
    grantMonths: v.optional(v.number()),
    validityDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await assertAdmin(ctx, args.adminId);

    const affiliate = await ctx.db.get(args.affiliateId);
    if (!affiliate) throw new Error('AFFILIATE_NOT_FOUND');
    if (affiliate.kind !== 'partner') throw new Error('NOT_A_PARTNER_AFFILIATE');
    if (affiliate.status !== 'active') throw new Error('AFFILIATE_DISABLED');

    const grantMonths = args.grantMonths ?? DEFAULT_PARTNER_COMP_MONTHS;
    if (!Number.isInteger(grantMonths) || grantMonths < 1 || grantMonths > 24) {
      throw new Error('INVALID_GRANT_MONTHS');
    }
    const validityDays = args.validityDays ?? PARTNER_INVITE_VALIDITY_DAYS;
    if (!Number.isInteger(validityDays) || validityDays < 1 || validityDays > 365) {
      throw new Error('INVALID_VALIDITY_DAYS');
    }

    // Un seul lien vivant par partenaire : deux liens ouverts, c'est deux
    // comptes agence offerts pour un partenariat. Les anciens sont révoqués
    // plutôt que refusés — regénérer un lien perdu doit rester trivial.
    const now = Date.now();
    const previous = await ctx.db
      .query('partnerInvites')
      .withIndex('by_affiliate', (q) => q.eq('affiliateId', args.affiliateId))
      .collect();
    for (const inv of previous) {
      if (inviteState(inv, now) === 'usable') {
        await ctx.db.patch(inv._id, { revokedAt: now });
      }
    }

    const token = generateToken();
    const id = await ctx.db.insert('partnerInvites', {
      token,
      affiliateId: args.affiliateId,
      inviteeEmail: args.inviteeEmail?.trim().toLowerCase(),
      inviteeName: args.inviteeName?.trim(),
      grantTier: args.grantTier ?? DEFAULT_PARTNER_COMP_TIER,
      grantMonths,
      expiresAt: inviteExpiresAt(now, validityDays),
      createdBy: args.adminId,
      createdAt: now,
    });

    await ctx.db.insert('adminAuditLog', {
      adminId: args.adminId,
      action: 'create_partner_invite',
      targetType: 'partner_invite',
      targetId: id,
      details: JSON.stringify({
        affiliateCode: affiliate.code,
        grantTier: args.grantTier ?? DEFAULT_PARTNER_COMP_TIER,
        grantMonths,
        validityDays,
        revokedPrevious: previous.filter((p) => inviteState(p, now) === 'revoked').length,
      }),
      createdAt: now,
    });

    return { id, token };
  },
});

export const revoke = mutation({
  args: { adminId: v.id('users'), inviteId: v.id('partnerInvites') },
  handler: async (ctx, { adminId, inviteId }) => {
    await assertAdmin(ctx, adminId);
    const invite = await ctx.db.get(inviteId);
    if (!invite) throw new Error('INVITE_NOT_FOUND');
    // Un lien déjà utilisé ne se révoque pas : le compte existe, le cadeau est
    // accordé. Le retirer se fait sur l'organisation, pas sur le lien.
    if (invite.consumedAt) throw new Error('INVITE_ALREADY_CONSUMED');
    if (invite.revokedAt) return { ok: true as const };

    const now = Date.now();
    await ctx.db.patch(inviteId, { revokedAt: now });
    await ctx.db.insert('adminAuditLog', {
      adminId,
      action: 'revoke_partner_invite',
      targetType: 'partner_invite',
      targetId: inviteId,
      createdAt: now,
    });
    return { ok: true as const };
  },
});

/**
 * Liens d'invitation, du plus récent au plus ancien, avec leur état lisible.
 * Sans `affiliateId`, rend tous les liens — le tableau des affiliés les affiche
 * par ligne, et ils se comptent en dizaines, pas en milliers.
 */
export const listForAdmin = query({
  args: { adminId: v.id('users'), affiliateId: v.optional(v.id('affiliates')) },
  handler: async (ctx, { adminId, affiliateId }) => {
    await assertAdmin(ctx, adminId);
    const now = Date.now();
    const rows = affiliateId
      ? await ctx.db
          .query('partnerInvites')
          .withIndex('by_affiliate', (q) => q.eq('affiliateId', affiliateId))
          .order('desc')
          .collect()
      : await ctx.db.query('partnerInvites').order('desc').collect();
    return rows.map((inv) => ({
      id: inv._id,
      affiliateId: inv.affiliateId,
      // Le jeton n'est rendu que tant qu'il sert à quelque chose : un lien
      // consommé ou révoqué n'a plus de raison de circuler.
      token: inviteState(inv, now) === 'usable' ? inv.token : null,
      state: inviteState(inv, now),
      inviteeEmail: inv.inviteeEmail ?? null,
      inviteeName: inv.inviteeName ?? null,
      grantTier: inv.grantTier,
      grantMonths: inv.grantMonths,
      expiresAt: inv.expiresAt,
      consumedAt: inv.consumedAt ?? null,
      createdAt: inv.createdAt,
    }));
  },
});

/* -------------------------------------------------------------------------- */
/*  Page publique d'acceptation                                                */
/* -------------------------------------------------------------------------- */

/**
 * Ce que la page `/rejoindre/[token]` a le droit de savoir : ce qui est offert
 * et à qui, jamais le taux de commission de l'affilié ni son ledger. La page
 * est publique — le jeton en est la seule protection.
 */
export const getByToken = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const invite = await ctx.db
      .query('partnerInvites')
      .withIndex('by_token', (q) => q.eq('token', token))
      .first();
    if (!invite) return null;
    const affiliate = await ctx.db.get(invite.affiliateId);
    return {
      state: inviteState(invite, Date.now()),
      inviteeEmail: invite.inviteeEmail ?? null,
      inviteeName: invite.inviteeName ?? null,
      grantTier: invite.grantTier,
      grantMonths: invite.grantMonths,
      expiresAt: invite.expiresAt,
      partnerName: affiliate?.displayName ?? null,
      /** Le code que la partenaire pourra partager — la seconde moitié du deal. */
      partnerCode: affiliate?.stripePromotionCodeId ? affiliate.code : null,
    };
  },
});

/**
 * Accepte le lien : crée (ou adopte) l'organisation, pose le cadeau, rattache
 * l'affilié au compte, consomme le jeton. Tout ou rien.
 */
export const redeem = mutation({
  args: {
    token: v.string(),
    userId: v.id('users'),
    organizationName: v.string(),
  },
  handler: async (ctx, { token, userId, organizationName }) => {
    const invite = await ctx.db
      .query('partnerInvites')
      .withIndex('by_token', (q) => q.eq('token', token))
      .first();
    if (!invite) throw new Error('INVITE_NOT_FOUND');

    const now = Date.now();
    const state = inviteState(invite, now);
    if (state !== 'usable') throw new Error(`INVITE_${state.toUpperCase()}`);

    const user = await ctx.db.get(userId);
    if (!user) throw new Error('USER_NOT_FOUND');

    const name = organizationName.trim();
    if (name.length < 1 || name.length > 120) throw new Error('INVALID_NAME');

    // Une organisation existante est adoptée plutôt que dupliquée — sauf si
    // elle est déjà cliente : lui poser un cadeau la sortirait du MRR alors
    // qu'elle paie. Ce cas-là se règle à la main, pas par un lien.
    const existingOrg = await ctx.db
      .query('organizations')
      .withIndex('by_owner', (q) => q.eq('ownerId', userId))
      .first();
    if (existingOrg?.stripeSubscriptionId) throw new Error('ORG_ALREADY_SUBSCRIBED');

    const comp = {
      tier: invite.grantTier,
      grantedBy: invite.createdBy,
      grantedAt: now,
      expiresAt: compExpiresAt(now, invite.grantMonths),
      reason: 'partner_invite',
      affiliateId: invite.affiliateId,
    };

    let organizationId: Id<'organizations'>;
    if (existingOrg) {
      organizationId = existingOrg._id;
      await ctx.db.patch(existingOrg._id, {
        // Le tier est écrit sur l'organisation, pas seulement dans le cadeau :
        // sans lui, `eventQuotaForTier` rendrait `null`, c'est-à-dire des
        // mariages illimités.
        subscriptionTier: invite.grantTier,
        compedSubscription: comp,
        updatedAt: now,
      });
    } else {
      // `organizations.create` exige le rôle pro ; une partenaire qui s'inscrit
      // depuis ce lien arrive en `couple` par défaut. La promotion fait partie
      // du cadeau — sans elle, le lien s'arrêterait sur un `NOT_PRO`.
      if (user.role !== 'pro' && user.role !== 'admin') {
        await ctx.db.patch(userId, { role: 'pro' as const });
      }
      const baseSlug = slugifyOrgName(name) || `agence-${invite.token.slice(0, 6).toLowerCase()}`;
      const slug = await pickUniqueSlug(ctx, 'organizations', 'by_slug', 'slug', baseSlug);
      organizationId = await ctx.db.insert('organizations', {
        ownerId: userId,
        name,
        slug,
        subscriptionTier: invite.grantTier,
        compedSubscription: comp,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert('organizationMemberships', {
        organizationId,
        userId,
        role: 'owner' as const,
        status: 'active' as const,
        invitedBy: userId,
        invitedAt: now,
        acceptedAt: now,
      });
    }

    // Rattache l'affilié au compte : c'est ce qui rend `/partenaire` visible.
    // Sans `ownerUserId`, `partnerDashboard` scope sur `by_owner` et ne trouve
    // rien — la partenaire aurait un code qui rapporte et aucune page pour le
    // constater.
    const affiliate = await ctx.db.get(invite.affiliateId);
    if (affiliate && !affiliate.ownerUserId) {
      await ctx.db.patch(invite.affiliateId, { ownerUserId: userId, updatedAt: now });
    }

    await ctx.db.patch(invite._id, {
      consumedAt: now,
      consumedByUserId: userId,
      consumedOrganizationId: organizationId,
    });

    return {
      organizationId,
      compExpiresAt: comp.expiresAt,
      tier: invite.grantTier,
      partnerCode: affiliate?.stripePromotionCodeId ? affiliate.code : null,
    };
  },
});
