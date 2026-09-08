'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Download, ScanFace } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PhotoUploader } from './photo-uploader';
import { FaceSearchModal } from './face-search-modal';
import {
  createOwnerUploadUrlAction,
  confirmOwnerUploadAction,
  moderatePhotoAction,
  removePhotoAction,
  faceSearchOwnerAction,
} from '@/app/[locale]/(app)/events/[eventId]/gallery/actions';

type Status = 'pending' | 'approved' | 'rejected';

export interface OwnerPhotoItem {
  _id: string;
  url: string | null;
  /**
   * Variantes WebP responsives générées par le Lambda Sharp à l'upload.
   * - `thumb` (256 px) → grid masonry. ~12 KB / image vs ~2 MB original.
   * - `medium` (1024 px) → lightbox.
   * - `large` (2048 px) → download.
   * Fallback sur `url` si absentes (anciennes photos / Lambda en échec).
   */
  variants?: { thumb?: string; medium?: string; large?: string };
  status: Status;
  uploaderName?: string;
  uploadedByGuestToken?: boolean;
  width?: number;
  height?: number;
  sizeBytes: number;
  contentType: string;
  createdAt: number;
  /** Raison renvoyée par Rekognition (rejet ou review manuel). */
  moderationReason?: string;
  moderationDecision?: 'approved' | 'rejected' | 'manual_review';
}

interface Props {
  eventId: string;
  initialPhotos: OwnerPhotoItem[];
  /**
   * Téléchargement ZIP de la galerie = feature Premium (cf.
   * PREMIUM_EXTRA_FEATURES). Masque le bouton pour les formules qui n'y ont
   * pas droit (la route /download-zip enforce de toute façon côté serveur).
   * Défaut `true` pour rétro-compat.
   */
  canDownloadZip?: boolean;
  /**
   * Reco-faciale opt-in explicite (Lane T3, F7) — `event.faceSearchEnabled`.
   * Défaut `false` (fail-safe) : masque le bouton « Find me in the photos »
   * tant que le couple n'a pas activé la feature depuis la page d'édition
   * (`FaceSearchPrivacySection`). L'action serveur reste de toute façon
   * gardée par la même règle (`FACE_SEARCH_DISABLED`).
   */
  faceSearchEnabled?: boolean;
  /**
   * Galerie en SURSIS : la couverture de l'agence s'est éteinte, les photos
   * restent consultables quelques semaines mais le dépôt est clos. Le serveur
   * rejette de toute façon l'upload (`GALLERY_EXPIRED`) — masquer le
   * téléversement évite de le proposer pour rien. Défaut `false`.
   */
  readOnly?: boolean;
}

const FILTERS = ['all', 'pending', 'approved', 'rejected'] as const;

export function OwnerGallery({
  eventId,
  initialPhotos,
  canDownloadZip = true,
  faceSearchEnabled = false,
  readOnly = false,
}: Props) {
  const t = useTranslations('Gallery');
  const locale = useLocale();
  const router = useRouter();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');
  const [pending, startTransition] = useTransition();
  const [faceSearchOpen, setFaceSearchOpen] = useState(false);
  const [faceMatchedIds, setFaceMatchedIds] = useState<string[] | null>(null);

  const filtered = useMemo(() => {
    let list = initialPhotos;
    if (filter !== 'all') list = list.filter((p) => p.status === filter);
    if (faceMatchedIds !== null) {
      const set = new Set(faceMatchedIds);
      list = list.filter((p) => set.has(p._id));
    }
    return list;
  }, [filter, initialPhotos, faceMatchedIds]);

  const counts = useMemo(
    () => ({
      all: initialPhotos.length,
      pending: initialPhotos.filter((p) => p.status === 'pending').length,
      approved: initialPhotos.filter((p) => p.status === 'approved').length,
      rejected: initialPhotos.filter((p) => p.status === 'rejected').length,
    }),
    [initialPhotos],
  );

  const approvedCount = counts.approved;
  const pendingCount = counts.pending;
  const downloadAllHref = `/${locale}/events/${eventId}/gallery/download-zip`;

  // Auto-refresh tant qu'il y a des photos `pending` (= en cours de modération
  // Rekognition + OpenAI). Le callback Lambda met 2-5s en moyenne, on refresh
  // toutes les 4s. Dès que toutes les photos sont approved/rejected, on stoppe
  // pour ne pas spammer le serveur. Pas de timeout dur — si Lambda est down,
  // l'owner peut toujours rafraîchir manuellement ou modérer à la main.
  useEffect(() => {
    if (pendingCount === 0) return;
    const interval = setInterval(() => {
      router.refresh();
    }, 4000);
    return () => clearInterval(interval);
  }, [pendingCount, router]);

  function runDecision(photoId: string, decision: 'approved' | 'rejected') {
    startTransition(async () => {
      const result = await moderatePhotoAction(eventId, photoId, decision);
      if (result.ok) router.refresh();
    });
  }

  function runRemove(photoId: string) {
    startTransition(async () => {
      const result = await removePhotoAction(eventId, photoId);
      if (result.ok) router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-ivory-100)] px-4 py-3 text-sm leading-relaxed text-[color:var(--color-ink-700)]">
        {t('moderationNotice')}
      </p>
      {readOnly ? null : (
        <PhotoUploader
          mode="owner"
          eventId={eventId}
          getUploadUrl={createOwnerUploadUrlAction}
          confirm={confirmOwnerUploadAction}
          onUploaded={() => router.refresh()}
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`focus-ring rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                filter === f
                  ? 'border-[color:var(--color-accent)] bg-[color:var(--color-accent)] text-white'
                  : 'border-[color:var(--color-border)] bg-[color:var(--color-surface)]'
              }`}
              data-testid={`filter-${f}`}
            >
              {t(`filters.${f}`)} · {counts[f]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {faceSearchEnabled ? (
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={() => setFaceSearchOpen(true)}
              data-testid="face-search-trigger"
            >
              <ScanFace className="h-4 w-4" aria-hidden strokeWidth={1.75} />
              {t('faceSearch.trigger')}
            </Button>
          ) : null}
          {faceMatchedIds !== null ? (
            <Button
              type="button"
              variant="ghost"
              size="md"
              onClick={() => setFaceMatchedIds(null)}
              data-testid="face-search-clear"
            >
              {t('faceSearch.showAll')}
            </Button>
          ) : null}
          {canDownloadZip ? (
            approvedCount > 0 ? (
              <a
                href={downloadAllHref}
                className="focus-ring inline-flex items-center gap-2 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2 text-sm font-medium transition-colors hover:bg-[color:var(--color-ivory-100)]"
                data-testid="download-all"
                download
              >
                <Download className="h-4 w-4" aria-hidden strokeWidth={1.75} />
                {t('downloadAll')}
              </a>
            ) : (
              <span
                className="inline-flex cursor-not-allowed items-center gap-2 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2 text-sm font-medium opacity-60"
                data-testid="download-all-disabled"
                title={t('downloadEmpty')}
                aria-disabled="true"
              >
                <Download className="h-4 w-4" aria-hidden strokeWidth={1.75} />
                {t('downloadAll')}
              </span>
            )
          ) : null}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p
          className="rounded-xl border border-dashed border-[color:var(--color-border)] p-10 text-center text-sm text-[color:var(--color-muted)]"
          data-testid="gallery-empty"
        >
          {t('empty')}
        </p>
      ) : (
        <ul
          className="columns-1 gap-3 [column-fill:_balance] sm:columns-2 md:columns-3 lg:columns-4"
          data-testid="photo-grid"
        >
          {filtered.map((p) => (
            <li
              key={p._id}
              className="mb-3 flex break-inside-avoid flex-col gap-2 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-2"
              data-testid="photo-card"
              data-status={p.status}
            >
              {p.url ? (
                // eslint-disable-next-line @next/next/no-img-element -- Convex storage URLs are external; next/image requires remotePatterns config
                <img
                  src={p.variants?.thumb ?? p.url}
                  alt=""
                  loading="lazy"
                  width={p.width}
                  height={p.height}
                  className="h-auto w-full rounded-lg"
                />
              ) : (
                <div
                  className="w-full rounded-lg bg-[color:var(--color-ivory-100)]"
                  style={{
                    aspectRatio: p.width && p.height ? `${p.width} / ${p.height}` : '1 / 1',
                  }}
                />
              )}
              <div className="flex items-center justify-end gap-2 text-xs">
                <Badge variant={statusVariant(p.status)}>{t(`status.${p.status}`)}</Badge>
              </div>
              {p.moderationReason &&
              (p.status === 'rejected' || p.moderationDecision === 'manual_review') ? (
                <p
                  className="text-xs leading-snug text-[color:var(--color-ink-500)]"
                  data-testid="moderation-reason"
                >
                  {p.moderationReason}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center justify-end gap-1">
                <a
                  href={`/${locale}/events/${eventId}/gallery/photos/${p._id}/download`}
                  className="focus-ring inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-[color:var(--color-ink-700)] transition-colors hover:bg-[color:var(--color-ivory-100)]"
                  data-testid="download-one"
                  aria-label={t('downloadOne')}
                  title={t('downloadOne')}
                  download
                >
                  <Download className="h-3.5 w-3.5" aria-hidden strokeWidth={1.75} />
                </a>
                {p.status !== 'approved' ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => runDecision(p._id, 'approved')}
                    disabled={pending}
                    data-testid="approve"
                  >
                    {t('approve')}
                  </Button>
                ) : null}
                {p.status !== 'rejected' ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => runDecision(p._id, 'rejected')}
                    disabled={pending}
                    data-testid="reject"
                  >
                    {t('reject')}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  onClick={() => runRemove(p._id)}
                  disabled={pending}
                  data-testid="remove"
                >
                  {t('remove')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <FaceSearchModal
        open={faceSearchOpen}
        onClose={() => setFaceSearchOpen(false)}
        onResult={(ids) => setFaceMatchedIds(ids)}
        search={(dataUrl) => faceSearchOwnerAction(eventId, dataUrl)}
      />
    </div>
  );
}

function statusVariant(status: Status): 'accent' | 'primary' | 'destructive' {
  if (status === 'approved') return 'accent';
  if (status === 'pending') return 'primary';
  return 'destructive';
}
