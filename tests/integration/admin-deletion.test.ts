// @vitest-environment edge-runtime
/**
 * Suppression définitive depuis le back-office admin, sur les VRAIES fonctions
 * Convex.
 *
 * Le back-office savait tout neutraliser et rien effacer : un partenaire ouvert
 * pour tester gardait son code (unique) à vie, et le compte agence que son lien
 * avait ouvert restait dans les tableaux. Ces tests couvrent les deux sorties
 * ajoutées — et surtout leurs REFUS, qui sont ce qui rend la fonctionnalité
 * utilisable sans risque : le ledger de commissions, un abonnement Stripe qui
 * court, une agence qui a une équipe.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { api, internal } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { newHarness, seedAdmin, seedEvent, seedUser, type Harness } from './utils/convex-harness';

let t: Harness;
let adminId: Id<'users'>;

beforeEach(async () => {
  t = newHarness();
  adminId = await seedAdmin(t);
});

/** Partenaire tel que l'ouvre /admin/affiliates. */
async function openPartner(code = 'TESTPART') {
  return t.mutation(api.affiliate.createAffiliate, {
    adminId,
    code,
    kind: 'partner',
    rewardType: 'cash',
    rateBps: 1000,
    buyerDiscountBps: 1000,
    displayName: 'Partenaire de test',
  });
}

/** Organisation possédée par `ownerId`, avec sa membership owner. */
async function seedOrg(
  ownerId: Id<'users'>,
  opts: {
    name?: string;
    stripeSubscriptionId?: string;
    subscriptionStatus?: 'active' | 'canceled';
  },
) {
  const now = Date.now();
  return t.run(async (ctx) => {
    const organizationId = await ctx.db.insert('organizations', {
      ownerId,
      name: opts.name ?? 'Agence test',
      slug: `agence-${Math.random().toString(36).slice(2, 8)}`,
      ...(opts.stripeSubscriptionId ? { stripeSubscriptionId: opts.stripeSubscriptionId } : {}),
      ...(opts.subscriptionStatus ? { subscriptionStatus: opts.subscriptionStatus } : {}),
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert('organizationMemberships', {
      organizationId,
      userId: ownerId,
      role: 'owner',
      status: 'active',
      invitedBy: ownerId,
      invitedAt: now,
      acceptedAt: now,
    });
    return organizationId;
  });
}

describe('affiliate.deleteAffiliate', () => {
  it('efface un partenaire de test et libère son code', async () => {
    const created = await openPartner();
    await t.mutation(api.affiliate.deleteAffiliate, { adminId, affiliateId: created.id });

    const remaining = await t.query(api.affiliate.listAffiliates, { adminId });
    expect(remaining).toHaveLength(0);

    // Le code est unique en base : le reprendre est la preuve qu'il est rendu.
    await expect(openPartner()).resolves.toMatchObject({ code: 'TESTPART' });
  });

  it("emporte les liens d'invitation du partenaire", async () => {
    const created = await openPartner();
    await t.mutation(api.partnerInvites.create, { adminId, affiliateId: created.id });
    expect(await t.query(api.partnerInvites.listForAdmin, { adminId })).toHaveLength(1);

    await t.mutation(api.affiliate.deleteAffiliate, { adminId, affiliateId: created.id });
    expect(await t.query(api.partnerInvites.listForAdmin, { adminId })).toHaveLength(0);
  });

  it("refuse dès qu'une commission existe — le ledger est comptable", async () => {
    const created = await openPartner();
    const buyerId = await seedUser(t, { phone: '+33600000010' });
    const eventId = await seedEvent(t, buyerId);
    await t.mutation(internal.affiliate.recordReferral, {
      affiliateId: created.id,
      sourceSessionId: 'cs_test_1',
      grossMinor: 5900,
      netMinor: 5310,
      currency: 'EUR',
      purchasedAt: Date.now(),
      eventId,
      buyerUserId: buyerId,
    });

    await expect(
      t.mutation(api.affiliate.deleteAffiliate, { adminId, affiliateId: created.id }),
    ).rejects.toThrow(/AFFILIATE_HAS_REFERRALS/);
    expect(await t.query(api.affiliate.listAffiliates, { adminId })).toHaveLength(1);
  });

  it('reste réservée aux admins', async () => {
    const created = await openPartner();
    const intruder = await seedUser(t, { phone: '+33600000011', role: 'pro' });
    await expect(
      t.mutation(api.affiliate.deleteAffiliate, { adminId: intruder, affiliateId: created.id }),
    ).rejects.toThrow(/FORBIDDEN/);
  });

  it('journalise la suppression avec le code effacé', async () => {
    const created = await openPartner('AUDITCODE');
    await t.mutation(api.affiliate.deleteAffiliate, { adminId, affiliateId: created.id });

    const log = await t.query(api.admin.listAuditLog, { adminId });
    const entry = log.find((l) => l.action === 'delete_affiliate');
    expect(entry).toBeDefined();
    expect(JSON.parse(entry!.details!)).toMatchObject({ code: 'AUDITCODE', kind: 'partner' });
  });
});

describe('admin.deleteUser', () => {
  it('efface le compte et tout ce qui en dépend', async () => {
    const userId = await seedUser(t, { email: 'test@wedillybird.com', fullName: 'Compte test' });
    const eventId = await seedEvent(t, userId);
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert('guests', {
        eventId,
        fullName: 'Invité test',
        plusOnesAllowed: 0,
        rsvpStatus: 'pending',
        qrCodeToken: 'qr-test-1',
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert('photos', {
        eventId,
        s3Key: 'raw/test.jpg',
        uploadedBy: userId,
        status: 'approved',
        sizeBytes: 1234,
        contentType: 'image/jpeg',
        createdAt: now,
      });
      await ctx.db.insert('payments', {
        userId,
        eventId,
        kind: 'plan',
        plan: 'premium',
        currency: 'EUR',
        amountMinor: 5900,
        provider: 'stripe',
        providerSessionId: 'cs_test_purge',
        status: 'succeeded',
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert('notifications', {
        userId,
        type: 'rsvp_response',
        createdAt: now,
      });
    });

    const res = await t.mutation(api.admin.deleteUser, {
      adminId,
      targetUserId: userId,
      confirmLabel: 'test@wedillybird.com',
    });
    expect(res.deleted).toMatchObject({ users: 1, events: 1, guests: 1, photos: 1, payments: 1 });

    await t.run(async (ctx) => {
      expect(await ctx.db.get(userId)).toBeNull();
      expect(await ctx.db.get(eventId)).toBeNull();
      expect(await ctx.db.query('guests').collect()).toHaveLength(0);
      expect(await ctx.db.query('photos').collect()).toHaveLength(0);
      expect(await ctx.db.query('payments').collect()).toHaveLength(0);
      expect(await ctx.db.query('notifications').collect()).toHaveLength(0);
    });
  });

  it('refuse un libellé de confirmation qui ne correspond pas', async () => {
    const userId = await seedUser(t, { email: 'confirm@wedillybird.com' });
    await expect(
      t.mutation(api.admin.deleteUser, { adminId, targetUserId: userId, confirmLabel: 'confirm@' }),
    ).rejects.toThrow(/CONFIRM_MISMATCH/);
    await t.run(async (ctx) => {
      expect(await ctx.db.get(userId)).not.toBeNull();
    });
  });

  it('refuse un compte administrateur', async () => {
    const other = await seedAdmin(t, '+33600000002');
    await expect(
      t.mutation(api.admin.deleteUser, {
        adminId,
        targetUserId: other,
        confirmLabel: '+33600000002',
      }),
    ).rejects.toThrow(/CANNOT_DELETE_ADMIN/);
  });

  it("refuse tant qu'un abonnement Stripe court encore", async () => {
    const userId = await seedUser(t, { email: 'pro@wedillybird.com', role: 'pro' });
    await seedOrg(userId, { stripeSubscriptionId: 'sub_123', subscriptionStatus: 'active' });

    await expect(
      t.mutation(api.admin.deleteUser, {
        adminId,
        targetUserId: userId,
        confirmLabel: 'pro@wedillybird.com',
      }),
    ).rejects.toThrow(/ORG_SUBSCRIPTION_ACTIVE/);
  });

  it("refuse d'emporter une agence qui a une équipe", async () => {
    const ownerId = await seedUser(t, { email: 'owner@wedillybird.com', role: 'pro' });
    const organizationId = await seedOrg(ownerId, {});
    const teammate = await seedUser(t, { email: 'planner@wedillybird.com', role: 'pro' });
    await t.run(async (ctx) =>
      ctx.db.insert('organizationMemberships', {
        organizationId,
        userId: teammate,
        role: 'planner',
        status: 'active',
        invitedBy: ownerId,
        invitedAt: Date.now(),
        acceptedAt: Date.now(),
      }),
    );

    await expect(
      t.mutation(api.admin.deleteUser, {
        adminId,
        targetUserId: ownerId,
        confirmLabel: 'owner@wedillybird.com',
      }),
    ).rejects.toThrow(/ORG_HAS_MEMBERS/);
  });

  it("emporte l'agence offerte d'un partenaire, clients compris", async () => {
    const ownerId = await seedUser(t, { email: 'partner@wedillybird.com', role: 'pro' });
    const organizationId = await seedOrg(ownerId, { name: 'Agence offerte' });
    await t.run(async (ctx) => {
      const now = Date.now();
      const clientId = await ctx.db.insert('clients', {
        organizationId,
        partnerA: 'Lead test',
        stage: 'lead',
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert('clientNotes', {
        clientId,
        organizationId,
        type: 'note',
        text: 'Appel de découverte',
        createdAt: now,
      });
    });

    await t.mutation(api.admin.deleteUser, {
      adminId,
      targetUserId: ownerId,
      confirmLabel: 'partner@wedillybird.com',
    });

    await t.run(async (ctx) => {
      expect(await ctx.db.get(organizationId)).toBeNull();
      expect(await ctx.db.query('clients').collect()).toHaveLength(0);
      expect(await ctx.db.query('clientNotes').collect()).toHaveLength(0);
      expect(await ctx.db.query('organizationMemberships').collect()).toHaveLength(0);
    });
  });

  it("réattribue à l'agence un mariage que la personne avait créé pour elle", async () => {
    const agencyOwner = await seedUser(t, { email: 'agence@wedillybird.com', role: 'pro' });
    const organizationId = await seedOrg(agencyOwner, { name: 'Agence tierce' });
    const planner = await seedUser(t, { email: 'salariee@wedillybird.com', role: 'pro' });
    const eventId = await seedEvent(t, planner);
    await t.run(async (ctx) => {
      await ctx.db.patch(eventId, { organizationId });
      await ctx.db.insert('organizationMemberships', {
        organizationId,
        userId: planner,
        role: 'planner',
        status: 'active',
        invitedBy: agencyOwner,
        invitedAt: Date.now(),
        acceptedAt: Date.now(),
      });
    });

    const res = await t.mutation(api.admin.deleteUser, {
      adminId,
      targetUserId: planner,
      confirmLabel: 'salariee@wedillybird.com',
    });
    expect(res.reassignedEvents).toBe(1);

    await t.run(async (ctx) => {
      const event = await ctx.db.get(eventId);
      expect(event?.ownerId).toBe(agencyOwner);
      // La membership de la salariée part, l'agence reste debout.
      expect(await ctx.db.get(organizationId)).not.toBeNull();
    });
  });

  it("détache le code d'affiliation sans toucher au ledger", async () => {
    const created = await openPartner('DETACH12');
    const ownerId = await seedUser(t, { email: 'affilie@wedillybird.com' });
    await t.mutation(api.affiliate.setAffiliateOwner, {
      adminId,
      affiliateId: created.id,
      ownerUserId: ownerId,
    });

    await t.mutation(api.admin.deleteUser, {
      adminId,
      targetUserId: ownerId,
      confirmLabel: 'affilie@wedillybird.com',
    });

    const affiliates = await t.query(api.affiliate.listAffiliates, { adminId });
    expect(affiliates).toHaveLength(1);
    await t.run(async (ctx) => {
      const aff = await ctx.db.get(created.id);
      expect(aff?.ownerUserId).toBeUndefined();
    });
  });

  it("journalise l'inventaire de ce qui a été détruit", async () => {
    const userId = await seedUser(t, { email: 'audit@wedillybird.com', fullName: 'Audit' });
    await seedEvent(t, userId);
    await t.mutation(api.admin.deleteUser, {
      adminId,
      targetUserId: userId,
      confirmLabel: 'audit@wedillybird.com',
    });

    const log = await t.query(api.admin.listAuditLog, { adminId });
    const entry = log.find((l) => l.action === 'delete_user');
    expect(entry).toBeDefined();
    expect(JSON.parse(entry!.details!)).toMatchObject({
      label: 'audit@wedillybird.com',
      fullName: 'Audit',
      deleted: { users: 1, events: 1 },
    });
  });
});

describe('organizations.deleteOrganization', () => {
  it("emporte ce que l'ancienne cascade laissait derrière elle", async () => {
    const ownerId = await seedUser(t, { email: 'agence@wedillybird.com', role: 'pro' });
    const organizationId = await seedOrg(ownerId, { name: 'Agence à fermer' });
    const eventId = await seedEvent(t, ownerId);
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.patch(eventId, { organizationId });
      // Trois tables que la cascade écrite à la main ne descendait pas.
      await ctx.db.insert('tables', {
        eventId,
        name: 'Table 1',
        capacity: 8,
        order: 0,
        createdAt: now,
        updatedAt: now,
      });
      const phaseId = await ctx.db.insert('couplePhases', {
        eventId,
        label: '6 mois avant',
        order: 0,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert('coupleTasks', {
        eventId,
        phaseId,
        label: 'Choisir le traiteur',
        status: 'todo',
        order: 0,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert('planningTemplates', {
        organizationId,
        name: 'Rétroplanning 12 mois',
        tasks: [],
        createdAt: now,
        updatedAt: now,
      });
    });

    await t.mutation(api.organizations.deleteOrganization, {
      organizationId,
      requesterId: ownerId,
      confirmName: 'Agence à fermer',
    });

    await t.run(async (ctx) => {
      expect(await ctx.db.get(organizationId)).toBeNull();
      expect(await ctx.db.get(eventId)).toBeNull();
      expect(await ctx.db.query('tables').collect()).toHaveLength(0);
      expect(await ctx.db.query('coupleTasks').collect()).toHaveLength(0);
      expect(await ctx.db.query('couplePhases').collect()).toHaveLength(0);
      expect(await ctx.db.query('planningTemplates').collect()).toHaveLength(0);
    });
  });

  it('laisse debout les paiements des couples — ce sont des encaissements plateforme', async () => {
    const ownerId = await seedUser(t, { email: 'agence2@wedillybird.com', role: 'pro' });
    const organizationId = await seedOrg(ownerId, { name: 'Agence payante' });
    const buyerId = await seedUser(t, { email: 'couple@wedillybird.com' });
    const eventId = await seedEvent(t, ownerId);
    await t.run(async (ctx) => {
      await ctx.db.patch(eventId, { organizationId });
      const now = Date.now();
      await ctx.db.insert('payments', {
        userId: buyerId,
        eventId,
        kind: 'plan',
        plan: 'premium',
        currency: 'EUR',
        amountMinor: 5900,
        provider: 'stripe',
        providerSessionId: 'cs_test_org_delete',
        status: 'succeeded',
        createdAt: now,
        updatedAt: now,
      });
    });

    await t.mutation(api.organizations.deleteOrganization, {
      organizationId,
      requesterId: ownerId,
      confirmName: 'Agence payante',
    });

    // Le CA reste lisible côté admin, l'acheteur aussi : seul l'événement
    // référencé a disparu, ce que les lectures gèrent déjà.
    const payments = await t.query(api.admin.listAllPayments, { adminId });
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ amountMinor: 5900, userEmail: 'couple@wedillybird.com' });
  });

  it('refuse un nom de confirmation qui ne correspond pas', async () => {
    const ownerId = await seedUser(t, { email: 'agence3@wedillybird.com', role: 'pro' });
    const organizationId = await seedOrg(ownerId, { name: 'Agence protégée' });

    await expect(
      t.mutation(api.organizations.deleteOrganization, {
        organizationId,
        requesterId: ownerId,
        confirmName: 'Agence protegee',
      }),
    ).rejects.toThrow(/NAME_MISMATCH/);
    await t.run(async (ctx) => {
      expect(await ctx.db.get(organizationId)).not.toBeNull();
    });
  });
});

describe('admin.userDeletionPreview', () => {
  it("annonce ce qui tombera avant qu'on le clique", async () => {
    const userId = await seedUser(t, { email: 'preview@wedillybird.com' });
    const eventId = await seedEvent(t, userId);
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert('guests', {
        eventId,
        fullName: 'Invité 1',
        plusOnesAllowed: 0,
        rsvpStatus: 'attending',
        qrCodeToken: 'qr-preview-1',
        createdAt: now,
        updatedAt: now,
      });
    });

    const preview = await t.query(api.admin.userDeletionPreview, { adminId, targetUserId: userId });
    expect(preview).toMatchObject({
      label: 'preview@wedillybird.com',
      counts: { events: 1, guests: 1, organizations: 0 },
      blockers: { isAdmin: false, billedOrgs: [], teamOrgs: [] },
    });
  });

  it('nomme les organisations qui bloquent la suppression', async () => {
    const userId = await seedUser(t, { email: 'billed@wedillybird.com', role: 'pro' });
    await seedOrg(userId, {
      name: 'Agence facturée',
      stripeSubscriptionId: 'sub_456',
      subscriptionStatus: 'active',
    });

    const preview = await t.query(api.admin.userDeletionPreview, { adminId, targetUserId: userId });
    expect(preview?.blockers.billedOrgs).toEqual(['Agence facturée']);
  });
});
