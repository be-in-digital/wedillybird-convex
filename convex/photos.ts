import { v } from 'convex/values';
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from './_generated/server';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { eventHasFeature, galleryAccessFor } from './lib/entitlements';
import {
  FACE_SEARCH_MAX_HITS,
  FACE_SEARCH_RATE_SCOPE,
  FACE_SEARCH_WINDOW_MS,
  decideRateLimit,
} from './lib/rateLimit';

const MAX_BYTES_PER_UPLOAD = 15 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

async function assertEventOwnership(
  ctx: MutationCtx | QueryCtx,
  eventId: Id<'events'>,
  userId: Id<'users'>,
): Promise<Doc<'events'>> {
  const event = await ctx.db.get(eventId);
  if (!event) throw new Error('EVENT_NOT_FOUND');
  if (event.ownerId !== userId) throw new Error('FORBIDDEN');
  return event;
}

async function resolveEventForToken(
  ctx: QueryCtx | MutationCtx,
  token: string,
): Promise<Doc<'events'>> {
  const guest = await ctx.db
    .query('guests')
    .withIndex('by_qr_token', (q) => q.eq('qrCodeToken', token))
    .first();
  if (!guest) throw new Error('INVITATION_NOT_FOUND');
  const event = await ctx.db.get(guest.eventId);
  if (!event) throw new Error('EVENT_NOT_FOUND');
  if (event.status === 'cancelled' || event.status === 'archived') {
    throw new Error('EVENT_CLOSED');
  }
  return event;
}

function cdnDomain(): string {
  const domain = process.env.CLOUDFRONT_DOMAIN;
  if (!domain) throw new Error('Missing CLOUDFRONT_DOMAIN env var on Convex deployment');
  return domain;
}

async function resolvePhotoUrl(ctx: QueryCtx, photo: Doc<'photos'>): Promise<string | null> {
  if (photo.s3Key) return `https://${cdnDomain()}/${photo.s3Key}`;
  if (photo.storageId) return await ctx.storage.getUrl(photo.storageId);
  return null;
}

/**
 * Convertit une key S3 (`processed/{eventId}/{photoId}/medium.webp`) en URL
 * CloudFront. Retourne `null` si la key est absente. Utilisé pour exposer
 * les variantes Sharp côté UI via la même distribution CDN que l'original.
 */
function variantUrl(s3Key: string | undefined): string | null {
  if (!s3Key) return null;
  return `https://${cdnDomain()}/${s3Key}`;
}

interface PublicVariants {
  thumb?: string;
  medium?: string;
  large?: string;
}

function resolveVariantUrls(photo: Doc<'photos'>): PublicVariants | undefined {
  if (!photo.variants) return undefined;
  const thumb = variantUrl(photo.variants.thumb);
  const medium = variantUrl(photo.variants.medium);
  const large = variantUrl(photo.variants.large);
  if (!thumb && !medium && !large) return undefined;
  return {
    ...(thumb ? { thumb } : {}),
    ...(medium ? { medium } : {}),
    ...(large ? { large } : {}),
  };
}

function assertUploadShape(sizeBytes: number, contentType: string): void {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_BYTES_PER_UPLOAD) {
    throw new Error('INVALID_SIZE');
  }
  if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
    throw new Error('INVALID_CONTENT_TYPE');
  }
}

/**
 * Gate uploads when the event's gallery is not open.
 *
 * Deux régimes (cf. `galleryAccessFor`) : un mariage de particulier ouvre sa
 * galerie à l'achat (`galleryExpiresAt`), un mariage d'agence tant que
 * l'organisation est couverte. Sans la seconde branche, **aucune** agence ne
 * pouvait déposer la moindre photo : `galleryExpiresAt` n'est jamais écrit
 * pour un event d'organisation, donc chaque upload partait en
 * `GALLERY_NOT_PURCHASED`.
 */
async function assertGalleryOpen(
  ctx: { db: { get: (id: Id<'organizations'>) => Promise<Doc<'organizations'> | null> } },
  event: Doc<'events'>,
): Promise<void> {
  const org = event.organizationId ? await ctx.db.get(event.organizationId) : null;
  const access = galleryAccessFor(event, org);
  if (access === 'locked') throw new Error('GALLERY_NOT_PURCHASED');
  if (access === 'expired') throw new Error('GALLERY_EXPIRED');
}

/* -------------------------------------------------------------------------- */
/*  Internal helpers used by Node actions (createOwnerS3UploadUrl, etc.)      */
/* -------------------------------------------------------------------------- */

export const assertOwnerCanUpload = internalQuery({
  args: { eventId: v.id('events'), requesterId: v.id('users') },
  handler: async (ctx, { eventId, requesterId }) => {
    await assertEventOwnership(ctx, eventId, requesterId);
    return { ok: true as const };
  },
});

export const assertGuestCanUpload = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const event = await resolveEventForToken(ctx, token);
    return { eventId: event._id };
  },
});

/**
 * Liste les photos en `status: pending` pour le script de reprocess
 * one-shot post-bug du 2026-05-23 (cf. `photosReprocess.ts`). Full scan
 * filtré — pas d'index `by_status` dans le schema car ce cas est sensé
 * être rare et transient. Si on rencontre régulièrement le besoin de
 * scanner tous les pending, ajouter l'index.
 */
export const listAllPendingForReprocess = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db
      .query('photos')
      .filter((q) => q.eq(q.field('status'), 'pending'))
      .take(limit);
    return rows.map((p) => ({
      _id: p._id,
      eventId: p.eventId,
      s3Key: p.s3Key,
      createdAt: p.createdAt,
    }));
  },
});

/* -------------------------------------------------------------------------- */
/*  Confirm upload (called after PUT to S3 succeeded)                         */
/* -------------------------------------------------------------------------- */

export const confirmOwnerUpload = mutation({
  args: {
    eventId: v.id('events'),
    requesterId: v.id('users'),
    s3Key: v.string(),
    sizeBytes: v.number(),
    contentType: v.string(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const event = await assertEventOwnership(ctx, args.eventId, args.requesterId);
    assertUploadShape(args.sizeBytes, args.contentType);
    await assertGalleryOpen(ctx, event);

    // Toutes les photos (owner ET guest) entrent en `pending` et passent par
    // la modération Rekognition (Lambda S3 → callback Convex). C'est le seul
    // moyen d'éviter qu'un owner uploade un contenu inapproprié visible sur
    // la galerie publique. L'owner peut override manuellement si Rekognition
    // rejette à tort, via `moderatePhoto` (bouton "Approuver" sur l'UI).
    const id = await ctx.db.insert('photos', {
      eventId: args.eventId,
      s3Key: args.s3Key,
      uploadedBy: args.requesterId,
      status: 'pending',
      sizeBytes: args.sizeBytes,
      contentType: args.contentType,
      width: args.width,
      height: args.height,
      createdAt: Date.now(),
    });
    return { id };
  },
});

export const confirmGuestUpload = mutation({
  args: {
    token: v.string(),
    s3Key: v.string(),
    sizeBytes: v.number(),
    contentType: v.string(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    uploaderName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const event = await resolveEventForToken(ctx, args.token);
    assertUploadShape(args.sizeBytes, args.contentType);
    await assertGalleryOpen(ctx, event);

    const id = await ctx.db.insert('photos', {
      eventId: event._id,
      s3Key: args.s3Key,
      uploadedByGuestToken: args.token,
      uploaderName: args.uploaderName?.trim().slice(0, 120) || undefined,
      status: 'pending',
      sizeBytes: args.sizeBytes,
      contentType: args.contentType,
      width: args.width,
      height: args.height,
      createdAt: Date.now(),
    });
    return { id };
  },
});

/* -------------------------------------------------------------------------- */
/*  Listing                                                                    */
/* -------------------------------------------------------------------------- */

export const listForOwner = query({
  args: {
    eventId: v.id('events'),
    requesterId: v.id('users'),
    status: v.optional(v.union(v.literal('pending'), v.literal('approved'), v.literal('rejected'))),
  },
  handler: async (ctx, { eventId, requesterId, status }) => {
    await assertEventOwnership(ctx, eventId, requesterId);
    const rows = status
      ? await ctx.db
          .query('photos')
          .withIndex('by_event_status', (q) => q.eq('eventId', eventId).eq('status', status))
          .order('desc')
          .collect()
      : await ctx.db
          .query('photos')
          .withIndex('by_event', (q) => q.eq('eventId', eventId))
          .order('desc')
          .collect();

    return Promise.all(
      rows.map(async (p) => ({
        _id: p._id,
        url: await resolvePhotoUrl(ctx, p),
        variants: resolveVariantUrls(p),
        status: p.status,
        uploaderName: p.uploaderName,
        uploadedByGuestToken: p.uploadedByGuestToken ? true : undefined,
        width: p.width,
        height: p.height,
        sizeBytes: p.sizeBytes,
        contentType: p.contentType,
        createdAt: p.createdAt,
        moderationReason: p.moderation?.reviewReason,
        moderationDecision: p.moderation?.decision,
      })),
    );
  },
});

export const listApprovedForGuest = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const event = await resolveEventForToken(ctx, token);
    const approved = await ctx.db
      .query('photos')
      .withIndex('by_event_status', (q) => q.eq('eventId', event._id).eq('status', 'approved'))
      .order('desc')
      .collect();

    // Inclut aussi les photos `pending` uploadées par CET invité spécifique.
    // Sans cela, après upload l'invité ne voit rien tant que Rekognition n'a
    // pas approuvé (2-5s en moyenne, ou jamais si la Lambda est down). On
    // filtre strictement sur `uploadedByGuestToken === token` pour ne pas
    // leak de contenu non-modéré aux autres invités.
    const ownPending = await ctx.db
      .query('photos')
      .withIndex('by_guest_token', (q) => q.eq('uploadedByGuestToken', token))
      .filter((q) => q.eq(q.field('status'), 'pending'))
      .collect();

    const rows = [...ownPending, ...approved].sort((a, b) => b.createdAt - a.createdAt);

    return Promise.all(
      rows.map(async (p) => ({
        _id: p._id,
        url: await resolvePhotoUrl(ctx, p),
        variants: resolveVariantUrls(p),
        status: p.status,
        uploaderName: p.uploaderName,
        width: p.width,
        height: p.height,
        createdAt: p.createdAt,
      })),
    );
  },
});

/* -------------------------------------------------------------------------- */
/*  Moderation + deletion                                                     */
/* -------------------------------------------------------------------------- */

export const moderate = mutation({
  args: {
    photoId: v.id('photos'),
    requesterId: v.id('users'),
    decision: v.union(v.literal('approved'), v.literal('rejected')),
  },
  handler: async (ctx, { photoId, requesterId, decision }) => {
    const photo = await ctx.db.get(photoId);
    if (!photo) throw new Error('PHOTO_NOT_FOUND');
    await assertEventOwnership(ctx, photo.eventId, requesterId);
    await ctx.db.patch(photoId, {
      status: decision,
      moderatedAt: Date.now(),
      moderatedBy: requesterId,
    });
    return { ok: true as const };
  },
});

export const remove = mutation({
  args: { photoId: v.id('photos'), requesterId: v.id('users') },
  handler: async (ctx, { photoId, requesterId }) => {
    const photo = await ctx.db.get(photoId);
    if (!photo) throw new Error('PHOTO_NOT_FOUND');
    const event = await assertEventOwnership(ctx, photo.eventId, requesterId);

    // Cleanup des rows photoFaces associées + libération des Face IDs côté
    // Rekognition. Best-effort : on collecte tous les faceIds, supprime les
    // rows DB, puis schedule un internal action pour appeler DeleteFaces.
    // Si l'event n'a pas de faceCollectionId, on saute l'appel AWS (rien à
    // libérer côté Rekognition).
    const photoFaceRows = await ctx.db
      .query('photoFaces')
      .withIndex('by_photo', (q) => q.eq('photoId', photoId))
      .collect();
    const faceIds: string[] = [];
    for (const row of photoFaceRows) {
      faceIds.push(row.faceId);
      await ctx.db.delete(row._id);
    }
    if (faceIds.length > 0 && event.faceCollectionId) {
      await ctx.scheduler.runAfter(0, internal.photosFaceSearch.deleteFacesFromCollection, {
        collectionId: event.faceCollectionId,
        faceIds,
      });
    }

    if (photo.s3Key) {
      await ctx.scheduler.runAfter(0, internal.photosActions.deleteS3Object, {
        s3Key: photo.s3Key,
      });
    } else if (photo.storageId) {
      await ctx.storage.delete(photo.storageId);
    }
    await ctx.db.delete(photoId);
    return { ok: true as const };
  },
});

/* -------------------------------------------------------------------------- */
/*  Internal mutations for Lambda callbacks (Phase 5: moderation, variants)   */
/* -------------------------------------------------------------------------- */

/**
 * Enregistre les visages extraits par le Lambda IndexFaces post-modération.
 *  1. Trouve la photo par `s3Key` ; abandonne si absente (photo déjà supprimée
 *     ou non encore confirmée — race condition rare).
 *  2. Patch l'event avec `faceCollectionId` si pas encore set (premier index
 *     pour cet event).
 *  3. Insère 1 row par face ; idempotent par `photoId + faceId` (re-livraison
 *     du callback ne crée pas de doublon).
 */
export const internalRegisterPhotoFaces = internalMutation({
  args: {
    s3Key: v.string(),
    collectionId: v.string(),
    faces: v.array(
      v.object({
        faceId: v.string(),
        boundingBox: v.optional(
          v.object({
            width: v.number(),
            height: v.number(),
            left: v.number(),
            top: v.number(),
          }),
        ),
        confidence: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, { s3Key, collectionId, faces }) => {
    const photo = await ctx.db
      .query('photos')
      .withIndex('by_s3_key', (q) => q.eq('s3Key', s3Key))
      .first();
    if (!photo) return { ok: false as const, error: 'PHOTO_NOT_FOUND' };

    const event = await ctx.db.get(photo.eventId);
    if (event && !event.faceCollectionId) {
      await ctx.db.patch(photo.eventId, { faceCollectionId: collectionId });
    }

    let inserted = 0;
    const now = Date.now();
    for (const face of faces) {
      // Idempotence : skip si déjà enregistré pour cette photo.
      const existing = await ctx.db
        .query('photoFaces')
        .withIndex('by_photo', (q) => q.eq('photoId', photo._id))
        .filter((q) => q.eq(q.field('faceId'), face.faceId))
        .first();
      if (existing) continue;
      await ctx.db.insert('photoFaces', {
        photoId: photo._id,
        eventId: photo.eventId,
        faceId: face.faceId,
        ...(face.boundingBox ? { boundingBox: face.boundingBox } : {}),
        ...(face.confidence !== undefined ? { confidence: face.confidence } : {}),
        createdAt: now,
      });
      inserted += 1;
    }

    return { ok: true as const, inserted, total: faces.length };
  },
});

/**
 * Vérifie qu'un requester (owner / collaborator / guestToken) peut utiliser
 * la recherche par face sur cet event ; retourne `event.faceCollectionId`
 * (peut être undefined si aucune photo n'a été indexée). Throw FORBIDDEN si
 * non autorisé.
 *
 * Utilisé par l'action `searchPhotosByFace` qui ne peut pas accéder à la DB
 * directement (action = runtime Node).
 */
export const _resolveSearchAccess = internalQuery({
  args: {
    eventId: v.id('events'),
    requesterId: v.optional(v.id('users')),
    guestToken: v.optional(v.string()),
  },
  handler: async (ctx, { eventId, requesterId, guestToken }) => {
    const event = await ctx.db.get(eventId);
    if (!event) return { ok: false as const, error: 'EVENT_NOT_FOUND' as const };

    let allowed = false;
    if (requesterId) {
      if (event.ownerId === requesterId) {
        allowed = true;
      } else {
        const collab = await ctx.db
          .query('eventCollaborators')
          .withIndex('by_event_user', (q) => q.eq('eventId', eventId).eq('userId', requesterId))
          .first();
        if (collab) allowed = true;
      }
    }
    if (!allowed && guestToken) {
      const guest = await ctx.db
        .query('guests')
        .withIndex('by_qr_token', (q) => q.eq('qrCodeToken', guestToken))
        .first();
      if (!guest) return { ok: false as const, error: 'INVALID_TOKEN' as const };
      if (guest.eventId !== eventId) return { ok: false as const, error: 'INVALID_TOKEN' as const };
      allowed = true;
    }
    if (!allowed) return { ok: false as const, error: 'FORBIDDEN' as const };

    // Gate par formule : la recherche par visage est une feature Premium
    // (cf. convex/lib/entitlements.ts). Essentiel / event non payé → bloqué,
    // y compris pour les invités d'un mariage Essentiel.
    if (!eventHasFeature(event, 'faceSearch')) {
      return { ok: false as const, error: 'FEATURE_NOT_IN_PLAN' as const };
    }

    // Gate opt-in (Lane T3, F7) : même un event dans le bon forfait ne peut
    // PAS chercher tant que le couple n'a pas explicitement activé la reco-
    // faciale (`events:setFaceSearchEnabled`). Défaut OFF — cf.
    // `events.faceSearchEnabled` sur schema.ts.
    if (event.faceSearchEnabled !== true) {
      return { ok: false as const, error: 'FACE_SEARCH_DISABLED' as const };
    }

    return {
      ok: true as const,
      faceCollectionId: event.faceCollectionId,
    };
  },
});

/**
 * Lecture minimale exposée au Lambda de modération via l'endpoint HTTP signé
 * `/lambda/face-search-enabled` (`convex/http.ts`) — appelée AVANT tout
 * `IndexFacesCommand` : c'est le vrai gate d'indexation biométrique (Lane T3,
 * F7). `false` si l'event n'existe plus ou n'a pas opt-in — fail-closed,
 * ne jamais indexer par défaut.
 */
export const _isFaceSearchEnabled = internalQuery({
  args: { eventId: v.id('events') },
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get(eventId);
    return { enabled: event?.faceSearchEnabled === true };
  },
});

/**
 * Pour un set de Rekognition Face IDs, retourne les `photoId` correspondants
 * (filtrés sur `status: 'approved'`, dédupliqués). Utilisé en aval de
 * `SearchFacesByImage`.
 */
export const _photoIdsForFaceIds = internalQuery({
  args: {
    eventId: v.id('events'),
    faceIds: v.array(v.string()),
  },
  handler: async (ctx, { eventId, faceIds }) => {
    const photoIds = new Set<Id<'photos'>>();
    for (const faceId of faceIds) {
      const rows = await ctx.db
        .query('photoFaces')
        .withIndex('by_face', (q) => q.eq('faceId', faceId))
        .collect();
      for (const row of rows) {
        if (row.eventId !== eventId) continue;
        photoIds.add(row.photoId);
      }
    }
    const filtered: Id<'photos'>[] = [];
    for (const id of photoIds) {
      const photo = await ctx.db.get(id);
      if (photo && photo.status === 'approved') filtered.push(id);
    }
    return filtered;
  },
});

export const internalMarkModerated = internalMutation({
  args: {
    s3Key: v.string(),
    decision: v.union(v.literal('approved'), v.literal('rejected'), v.literal('manual_review')),
    topLabel: v.optional(v.string()),
    topConfidence: v.optional(v.number()),
    labels: v.optional(v.array(v.object({ name: v.string(), confidence: v.number() }))),
    ocrText: v.optional(v.string()),
    ocrFlaggedKeyword: v.optional(v.string()),
    contentLabels: v.optional(v.array(v.string())),
    reviewReason: v.optional(v.string()),
  },
  handler: async (
    ctx,
    {
      s3Key,
      decision,
      topLabel,
      topConfidence,
      labels,
      ocrText,
      ocrFlaggedKeyword,
      contentLabels,
      reviewReason,
    },
  ) => {
    const photo = await ctx.db
      .query('photos')
      .withIndex('by_s3_key', (q) => q.eq('s3Key', s3Key))
      .first();
    if (!photo) return { ok: false as const, error: 'PHOTO_NOT_FOUND' };
    const now = Date.now();
    // `manual_review` = Rekognition incertain → on garde `status: 'pending'` et
    // on stocke seulement le verdict + raison pour que l'owner puisse décider.
    // `approved` / `rejected` = on patch le status.
    const statusPatch =
      decision === 'manual_review' ? { status: 'pending' as const } : { status: decision };
    await ctx.db.patch(photo._id, {
      ...statusPatch,
      moderatedAt: now,
      moderation: {
        source: 'rekognition' as const,
        decision,
        topLabel,
        topConfidence,
        labels,
        ocrText,
        ocrFlaggedKeyword,
        contentLabels,
        reviewReason,
        decidedAt: now,
      },
    });
    return { ok: true as const };
  },
});

/**
 * Enregistre les variantes WebP générées par le Lambda Sharp (thumb/medium/
 * large). Idempotent : un re-upload de la même photo écrase les keys (le
 * naming `processed/{eventId}/{photoId}/{size}.webp` est déterministe).
 *
 * Best-effort : si la photo a été supprimée entre l'upload et le callback,
 * on no-op. Les keys peuvent être partiellement set (ex: thumb réussi mais
 * medium en échec) — la mutation merge avec les valeurs existantes.
 */
export const internalSetVariants = internalMutation({
  args: {
    s3Key: v.string(),
    variants: v.object({
      thumb: v.optional(v.string()),
      medium: v.optional(v.string()),
      large: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { s3Key, variants }) => {
    const photo = await ctx.db
      .query('photos')
      .withIndex('by_s3_key', (q) => q.eq('s3Key', s3Key))
      .first();
    if (!photo) return { ok: false as const, error: 'PHOTO_NOT_FOUND' };

    const merged = {
      ...(photo.variants ?? {}),
      ...(variants.thumb ? { thumb: variants.thumb } : {}),
      ...(variants.medium ? { medium: variants.medium } : {}),
      ...(variants.large ? { large: variants.large } : {}),
    };
    await ctx.db.patch(photo._id, { variants: merged });
    return { ok: true as const };
  },
});

/* -------------------------------------------------------------------------- */
/*  Face search — public action consommée par les server actions Next         */
/* -------------------------------------------------------------------------- */

/**
 * Internal mutation : check + bump du bucket rate-limit pour `searchPhotosByFace`.
 * Limite anti-abus : `FACE_SEARCH_MAX_HITS` calls par `FACE_SEARCH_WINDOW_MS`
 * par requesterId (ou guestToken). Atomique côté Convex car une mutation
 * sérialise les writes sur le même document.
 */
export const _checkFaceSearchRateLimit = internalMutation({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const existing = await ctx.db
      .query('rateLimitBuckets')
      .withIndex('by_scope_key', (q) => q.eq('scope', FACE_SEARCH_RATE_SCOPE).eq('key', key))
      .first();

    const now = Date.now();
    const decision = decideRateLimit(
      existing ? { count: existing.count, windowStartedAt: existing.windowStartedAt } : null,
      now,
      FACE_SEARCH_MAX_HITS,
      FACE_SEARCH_WINDOW_MS,
    );

    if (!decision.allow) {
      return { allow: false as const, retryAfterMs: decision.retryAfterMs };
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        count: decision.nextState.count,
        windowStartedAt: decision.nextState.windowStartedAt,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert('rateLimitBuckets', {
        scope: FACE_SEARCH_RATE_SCOPE,
        key,
        count: decision.nextState.count,
        windowStartedAt: decision.nextState.windowStartedAt,
        updatedAt: now,
      });
    }
    return { allow: true as const };
  },
});

/**
 * Recherche de photos par selfie. Trampoline qui :
 *  1. Applique un rate-limit anti-abus (10 appels / 60s par requester)
 *  2. Vérifie l'autorisation (owner / collaborator / guestToken)
 *  3. Charge `event.faceCollectionId` ; absent → NO_COLLECTION_YET
 *  4. Délègue à `internal.photosFaceSearch.searchByImage` (Node runtime)
 *     pour appeler Rekognition `SearchFacesByImage`
 *  5. Croise les Face IDs trouvés avec `photoFaces` → `photoId[]` filtré
 *     sur `status: 'approved'` puis dédupliqué
 *
 * Le selfie n'est jamais persisté : il transite uniquement en mémoire vers
 * Rekognition.
 */
export type SearchPhotosByFaceResult =
  | { ok: true; photoIds: string[]; matchCount: number }
  | {
      ok: false;
      error:
        | 'NO_FACE_DETECTED'
        | 'NO_COLLECTION_YET'
        | 'FORBIDDEN'
        | 'INVALID_TOKEN'
        | 'FEATURE_NOT_IN_PLAN'
        | 'FACE_SEARCH_DISABLED'
        | 'RATE_LIMITED'
        | 'UNKNOWN';
    };

export const searchPhotosByFace = action({
  args: {
    eventId: v.id('events'),
    selfieBase64: v.string(),
    requesterId: v.optional(v.id('users')),
    guestToken: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<SearchPhotosByFaceResult> => {
    // Rate-limit avant tout autre travail : on évite de payer un round-trip
    // à Rekognition pour un caller en abus. La clé combine requesterId OU
    // guestToken — un caller anonyme sans rien fournir tombe sur la chaîne
    // `anonymous` (rare mais possible dans les tests).
    const rateKey = args.requesterId
      ? `user:${args.requesterId}`
      : args.guestToken
        ? `guest:${args.guestToken}`
        : 'anonymous';
    const rate = await ctx.runMutation(internal.photos._checkFaceSearchRateLimit, {
      key: rateKey,
    });
    if (!rate.allow) {
      return { ok: false as const, error: 'RATE_LIMITED' as const };
    }

    const access = await ctx.runQuery(internal.photos._resolveSearchAccess, {
      eventId: args.eventId,
      requesterId: args.requesterId,
      guestToken: args.guestToken,
    });
    if (!access.ok) {
      if (access.error === 'EVENT_NOT_FOUND' || access.error === 'FORBIDDEN') {
        return { ok: false as const, error: 'FORBIDDEN' as const };
      }
      if (access.error === 'INVALID_TOKEN') {
        return { ok: false as const, error: 'INVALID_TOKEN' as const };
      }
      if (access.error === 'FEATURE_NOT_IN_PLAN') {
        return { ok: false as const, error: 'FEATURE_NOT_IN_PLAN' as const };
      }
      if (access.error === 'FACE_SEARCH_DISABLED') {
        return { ok: false as const, error: 'FACE_SEARCH_DISABLED' as const };
      }
      return { ok: false as const, error: 'UNKNOWN' as const };
    }

    if (!access.faceCollectionId) {
      return { ok: false as const, error: 'NO_COLLECTION_YET' as const };
    }

    let searchResult:
      | { status: 'matches'; faceIds: string[] }
      | { status: 'no_face_in_selfie' }
      | { status: 'no_match' };
    try {
      searchResult = await ctx.runAction(internal.photosFaceSearch.searchByImage, {
        collectionId: access.faceCollectionId,
        selfieBase64: args.selfieBase64,
      });
    } catch (err) {
      console.error(
        `[searchPhotosByFace] Rekognition error: ${err instanceof Error ? err.message : err}`,
      );
      return { ok: false as const, error: 'UNKNOWN' as const };
    }

    if (searchResult.status === 'no_face_in_selfie') {
      return { ok: false as const, error: 'NO_FACE_DETECTED' as const };
    }
    if (searchResult.status === 'no_match') {
      return { ok: true as const, photoIds: [], matchCount: 0 };
    }

    const photoIds: Id<'photos'>[] = await ctx.runQuery(internal.photos._photoIdsForFaceIds, {
      eventId: args.eventId,
      faceIds: searchResult.faceIds,
    });
    return {
      ok: true as const,
      photoIds: photoIds.map((id) => id.toString()),
      matchCount: photoIds.length,
    };
  },
});
