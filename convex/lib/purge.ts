/**
 * Suppression en cascade — événement, organisation, compte.
 *
 * Le back-office savait *neutraliser* (suspendre un compte, désactiver un
 * affilié, annuler un événement) mais jamais **effacer** : un compte ouvert
 * par erreur — un partenaire créé pour tester, une agence de démo — restait
 * là, indéfiniment, à fausser les compteurs et à occuper un code.
 *
 * Effacer proprement demande de descendre tout le graphe : `events.ownerId`,
 * `payments.userId`, `organizations.ownerId` ne sont pas optionnels, donc un
 * `delete` sur le seul document `users` laisserait des enfants pointant dans
 * le vide — et des écrans qui plantent. Ce module centralise la descente pour
 * que tous les chemins de suppression effacent EXACTEMENT la même chose.
 *
 * Ce qui n'est volontairement PAS effacé :
 *  - les champs de *provenance* portés par des documents d'autrui
 *    (`organizationMemberships.invitedBy`, `paymentLinks.createdBy`…). Ils
 *    deviennent des références mortes — `ctx.db.get` rend `null`, et toutes
 *    les lectures concernées le gèrent déjà. Les nettoyer supposerait de
 *    balayer des tables entières à chaque suppression ;
 *  - le ledger d'affiliation, jamais : une commission due ou versée est une
 *    écriture comptable. Un affilié rattaché au compte est simplement
 *    DÉTACHÉ (`ownerUserId` retiré), le code et ses lignes survivent ;
 *  - `newsletterSubscribers`, qui est une liste de consentement indépendante
 *    du compte (on peut être abonné sans compte, et l'inverse).
 */
import type { MutationCtx } from '../_generated/server';
import type { Id, TableNames } from '../_generated/dataModel';
import { internal } from '../_generated/api';

/** Chantier de suppression : ce qui est tombé, et ce qu'il reste à ne pas refaire. */
export interface Purge {
  /** Documents supprimés par table. Une table intacte n'apparaît pas. */
  deleted: Record<string, number>;
  /** Objets S3 dont la suppression a été planifiée (photos de galerie). */
  s3Objects: number;
  /** Événements réattribués à l'organisation propriétaire plutôt qu'effacés. */
  reassignedEvents: number;
  /**
   * Ids déjà supprimés. Les cascades se recoupent — un paiement est atteint
   * par son événement ET par son acheteur — et Convex refuse un second
   * `delete` sur le même id : la mémoire fait partie de l'opération.
   */
  seen: Set<string>;
}

export function newPurge(): Purge {
  return { deleted: {}, s3Objects: 0, reassignedEvents: 0, seen: new Set() };
}

/** Inventaire journalisable (le `Set` d'ids n'a rien à faire dans l'audit). */
export function purgeSummary(purge: Purge): {
  deleted: Record<string, number>;
  s3Objects: number;
  reassignedEvents: number;
} {
  return {
    deleted: purge.deleted,
    s3Objects: purge.s3Objects,
    reassignedEvents: purge.reassignedEvents,
  };
}

/** Supprime un document une seule fois, et le compte. */
async function drop<T extends TableNames>(
  ctx: MutationCtx,
  purge: Purge,
  table: T,
  id: Id<T>,
): Promise<void> {
  if (purge.seen.has(id)) return;
  purge.seen.add(id);
  await ctx.db.delete(id);
  purge.deleted[table] = (purge.deleted[table] ?? 0) + 1;
}

/**
 * Tables filles d'un événement, toutes indexées `by_event` sur `eventId`.
 *
 * `photos`, `quoteDocs` et `contracts` en sont absentes : elles demandent un
 * traitement propre (objets S3, sous-tables) fait juste avant.
 *
 * `payments` en est absente **délibérément**. Une ligne de paiement est
 * l'écriture d'un encaissement plateforme : c'est elle que lisent le CA admin
 * et `platformAnalytics`, et une agence qui supprime son compte n'a pas à
 * effacer le chiffre d'affaires que ses couples ont produit. Elle survit donc
 * à son événement — `listAllPayments`, `paymentsInvoice` et la réconciliation
 * Stripe traitent déjà l'événement absent. Ce qui la fait tomber, c'est la
 * suppression de son ACHETEUR (`payments.userId`, non optionnel), et c'est
 * `purgeUser` qui s'en charge, sous confirmation admin et avec inventaire.
 *
 * `photoBookOrders` y reste : une commande de livre n'est pas une écriture
 * comptable mais une tâche de fabrication, qui imprime une galerie. Sans
 * l'événement, elle n'est plus exécutable — le paiement qui l'a financée,
 * lui, subsiste.
 */
const EVENT_CHILD_TABLES = [
  'guests',
  'tables',
  'tableAssignments',
  'coupleVendors',
  'couplePayments',
  'couplePhases',
  'coupleTasks',
  'coupleRooms',
  'eventCollaborators',
  'photoBookOrders',
  'photoFaces',
  'whatsappTemplates',
  'budgetLines',
  'budgetPayments',
  'paymentLinks',
  'planningTasks',
  'vendorEngagements',
  'smsDeliveries',
  'smsDeliveryAlerts',
  'photoModerationAlerts',
] as const;

/**
 * Efface un événement et tout ce qui en dépend.
 *
 * Les photos partent aussi de S3 et leur collection Rekognition est libérée :
 * un événement effacé qui laisse ses fichiers en ligne continue de coûter, et
 * les visages indexés resteraient interrogeables.
 */
export async function purgeEvent(
  ctx: MutationCtx,
  purge: Purge,
  eventId: Id<'events'>,
): Promise<void> {
  const event = await ctx.db.get(eventId);
  if (!event) return;

  // Photos : fichiers d'abord (planifiés), rows ensuite.
  const photos = await ctx.db
    .query('photos')
    .withIndex('by_event', (q) => q.eq('eventId', eventId))
    .collect();
  for (const photo of photos) {
    if (photo.s3Key) {
      await ctx.scheduler.runAfter(0, internal.photosActions.deleteS3Object, {
        s3Key: photo.s3Key,
      });
      purge.s3Objects += 1;
    } else if (photo.storageId) {
      await ctx.storage.delete(photo.storageId);
    }
    await drop(ctx, purge, 'photos', photo._id);
  }
  if (event.faceCollectionId) {
    await ctx.scheduler.runAfter(0, internal.photosFaceSearch.deleteFaceCollection, {
      collectionId: event.faceCollectionId,
    });
  }

  // Documents commerciaux liés à l'événement : leur journal d'abord.
  for (const doc of await ctx.db
    .query('quoteDocs')
    .withIndex('by_event', (q) => q.eq('eventId', eventId))
    .collect()) {
    for (const act of await ctx.db
      .query('quoteActivity')
      .withIndex('by_doc', (q) => q.eq('docId', doc._id))
      .collect()) {
      await drop(ctx, purge, 'quoteActivity', act._id);
    }
    await drop(ctx, purge, 'quoteDocs', doc._id);
  }
  for (const contract of await ctx.db
    .query('contracts')
    .withIndex('by_event', (q) => q.eq('eventId', eventId))
    .collect()) {
    for (const audit of await ctx.db
      .query('contractAudit')
      .withIndex('by_contract', (q) => q.eq('contractId', contract._id))
      .collect()) {
      await drop(ctx, purge, 'contractAudit', audit._id);
    }
    await drop(ctx, purge, 'contracts', contract._id);
  }

  for (const table of EVENT_CHILD_TABLES) {
    const rows = await ctx.db
      .query(table)
      .withIndex('by_event', (q) => q.eq('eventId', eventId))
      .collect();
    for (const row of rows) await drop(ctx, purge, table, row._id);
  }

  // Un client appartient à l'AGENCE, pas au mariage : on coupe le lien plutôt
  // que d'effacer une fiche CRM qui survit à l'événement qu'elle a produit.
  for (const client of await ctx.db
    .query('clients')
    .withIndex('by_event', (q) => q.eq('eventId', eventId))
    .collect()) {
    await ctx.db.patch(client._id, { eventId: undefined });
  }

  await drop(ctx, purge, 'events', eventId);
}

/** Efface une organisation, ses événements et toutes ses tables métier. */
export async function purgeOrganization(
  ctx: MutationCtx,
  purge: Purge,
  organizationId: Id<'organizations'>,
): Promise<void> {
  const org = await ctx.db.get(organizationId);
  if (!org) return;

  for (const event of await ctx.db
    .query('events')
    .withIndex('by_organization', (q) => q.eq('organizationId', organizationId))
    .collect()) {
    await purgeEvent(ctx, purge, event._id);
  }

  for (const client of await ctx.db
    .query('clients')
    .withIndex('by_organization', (q) => q.eq('organizationId', organizationId))
    .collect()) {
    for (const note of await ctx.db
      .query('clientNotes')
      .withIndex('by_client', (q) => q.eq('clientId', client._id))
      .collect()) {
      await drop(ctx, purge, 'clientNotes', note._id);
    }
    await drop(ctx, purge, 'clients', client._id);
  }

  for (const doc of await ctx.db
    .query('quoteDocs')
    .withIndex('by_organization', (q) => q.eq('organizationId', organizationId))
    .collect()) {
    for (const act of await ctx.db
      .query('quoteActivity')
      .withIndex('by_doc', (q) => q.eq('docId', doc._id))
      .collect()) {
      await drop(ctx, purge, 'quoteActivity', act._id);
    }
    await drop(ctx, purge, 'quoteDocs', doc._id);
  }
  for (const contract of await ctx.db
    .query('contracts')
    .withIndex('by_organization', (q) => q.eq('organizationId', organizationId))
    .collect()) {
    for (const audit of await ctx.db
      .query('contractAudit')
      .withIndex('by_contract', (q) => q.eq('contractId', contract._id))
      .collect()) {
      await drop(ctx, purge, 'contractAudit', audit._id);
    }
    await drop(ctx, purge, 'contracts', contract._id);
  }

  for (const table of [
    'vendors',
    'vendorEngagements',
    'planningTasks',
    'planningTemplates',
    'budgetLines',
    'budgetPayments',
    'paymentLinks',
    'paygPurchases',
    'organizationMemberships',
  ] as const) {
    const rows = await ctx.db
      .query(table)
      .withIndex('by_organization', (q) => q.eq('organizationId', organizationId))
      .collect();
    for (const row of rows) await drop(ctx, purge, table, row._id);
  }

  if (org.logoStorageId) await ctx.storage.delete(org.logoStorageId);
  await drop(ctx, purge, 'organizations', organizationId);
}

/**
 * Efface un compte et tout ce qu'il possède.
 *
 * Deux nuances qui évitent des dégâts collatéraux :
 *  - un mariage rattaché à l'organisation de QUELQU'UN D'AUTRE (planneuse
 *    salariée d'une agence) est **réattribué** à la propriétaire de l'agence,
 *    pas effacé — il appartient à l'agence, pas à la personne qui l'a créé ;
 *  - un affilié rattaché au compte est détaché, jamais supprimé : son ledger
 *    est comptable (cf. `affiliate.deleteAffiliate` pour l'effacer, qui refuse
 *    dès qu'une commission existe).
 */
export async function purgeUser(
  ctx: MutationCtx,
  purge: Purge,
  userId: Id<'users'>,
): Promise<void> {
  const user = await ctx.db.get(userId);
  if (!user) return;

  for (const org of await ctx.db
    .query('organizations')
    .withIndex('by_owner', (q) => q.eq('ownerId', userId))
    .collect()) {
    await purgeOrganization(ctx, purge, org._id);
  }

  for (const event of await ctx.db
    .query('events')
    .withIndex('by_owner', (q) => q.eq('ownerId', userId))
    .collect()) {
    const org = event.organizationId ? await ctx.db.get(event.organizationId) : null;
    if (org && org.ownerId !== userId) {
      await ctx.db.patch(event._id, { ownerId: org.ownerId, updatedAt: Date.now() });
      purge.reassignedEvents += 1;
      continue;
    }
    await purgeEvent(ctx, purge, event._id);
  }

  for (const table of [
    'notifications',
    'eventCollaborators',
    'payments',
    'photoBookOrders',
    'linkVerifications',
    'organizationMemberships',
  ] as const) {
    const rows = await ctx.db
      .query(table)
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();
    for (const row of rows) await drop(ctx, purge, table, row._id);
  }

  for (const tpl of await ctx.db
    .query('whatsappTemplates')
    .withIndex('by_owner', (q) => q.eq('ownerId', userId))
    .collect()) {
    await drop(ctx, purge, 'whatsappTemplates', tpl._id);
  }

  // Le code d'affiliation survit au compte : seul le rattachement tombe.
  for (const affiliate of await ctx.db
    .query('affiliates')
    .withIndex('by_owner', (q) => q.eq('ownerUserId', userId))
    .collect()) {
    await ctx.db.patch(affiliate._id, { ownerUserId: undefined, updatedAt: Date.now() });
  }

  // Réservations de crédit en vol : table éphémère (GC 24 h), sans index par
  // compte — le balayage est sans conséquence à cette échelle.
  for (const pending of await ctx.db.query('pendingCreditApplications').collect()) {
    if (pending.userId === userId) {
      await drop(ctx, purge, 'pendingCreditApplications', pending._id);
    }
  }

  // Sessions d'authentification en attente : les laisser vivre offrirait un
  // code OTP / lien magique valide sur une identité qui n'existe plus.
  if (user.phone) {
    for (const otp of await ctx.db
      .query('otpSessions')
      .withIndex('by_phone', (q) => q.eq('phone', user.phone!))
      .collect()) {
      await drop(ctx, purge, 'otpSessions', otp._id);
    }
  }
  if (user.email) {
    for (const link of await ctx.db
      .query('magicLinkSessions')
      .withIndex('by_email', (q) => q.eq('email', user.email!))
      .collect()) {
      await drop(ctx, purge, 'magicLinkSessions', link._id);
    }
  }

  await drop(ctx, purge, 'users', userId);
}
