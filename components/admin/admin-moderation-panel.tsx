'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Check, ImageOff, MessageSquare, X } from 'lucide-react';
import { useServerAction } from '@/components/admin/use-admin-action';
import { formatDate } from '@/lib/admin/format';
import { adminModeratePhotoAction } from '@/app/[locale]/(app)/admin/actions';
import {
  AdminDataTable,
  AdminEmptyState,
  AdminSection,
  StatusPill,
  type AdminColumn,
  type StatusTone,
} from './ui';

type Photo = {
  _id: string;
  eventId: string;
  s3Key?: string;
  status: string;
  sizeBytes: number;
  contentType: string;
  uploaderName?: string;
  variants?: { thumb?: string; medium?: string; large?: string };
  createdAt: number;
};

type Template = {
  _id: string;
  eventId: string;
  name: string;
  bodyText: string;
  ctaLabel: string;
  status: string;
  rejectionReason?: string;
  submittedAt?: number;
  reviewedAt?: number;
  createdAt: number;
};

const TEMPLATE_STATUS_TONE: Record<string, StatusTone> = {
  draft: 'neutral',
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  paused: 'warning',
  disabled: 'danger',
};

export function AdminModerationPanel({
  photos,
  templates,
}: {
  photos: Photo[];
  templates: Template[];
}) {
  const t = useTranslations('Admin');
  const locale = useLocale();

  const templateColumns: AdminColumn<Template>[] = [
    {
      id: 'name',
      header: t('moderation.colName'),
      card: 'title',
      sortValue: (tpl) => tpl.name,
      cell: (tpl) => <span className="font-mono text-xs font-medium">{tpl.name}</span>,
    },
    {
      id: 'body',
      header: t('moderation.colBody'),
      className: 'max-w-xs truncate text-[color:var(--color-muted-foreground)]',
      cell: (tpl) => <span title={tpl.bodyText}>{tpl.bodyText}</span>,
    },
    {
      id: 'cta',
      header: t('moderation.colCta'),
      cell: (tpl) => (
        <span className="text-[color:var(--color-muted-foreground)]">{tpl.ctaLabel}</span>
      ),
      hideBelow: 'lg',
    },
    {
      id: 'status',
      header: t('moderation.colStatus'),
      card: 'badge',
      sortValue: (tpl) => tpl.status,
      cell: (tpl) => (
        <div className="flex flex-col items-start gap-1">
          <StatusPill tone={TEMPLATE_STATUS_TONE[tpl.status] ?? 'neutral'}>{tpl.status}</StatusPill>
          {tpl.rejectionReason ? (
            <p className="text-xs text-[color:var(--color-danger)]">{tpl.rejectionReason}</p>
          ) : null}
        </div>
      ),
    },
    {
      id: 'submittedAt',
      header: t('moderation.colSubmittedAt'),
      sortValue: (tpl) => tpl.submittedAt ?? null,
      cell: (tpl) => (
        <span className="whitespace-nowrap text-[color:var(--color-muted-foreground)]">
          {tpl.submittedAt ? formatDate(tpl.submittedAt, locale) : '—'}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      <AdminSection
        title={t('moderation.photosHeading', { count: photos.length })}
        description={t('moderation.photosDescription')}
        bare
      >
        {photos.length === 0 ? (
          <div className="rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)]">
            <AdminEmptyState
              icon={ImageOff}
              title={t('moderation.photosEmpty')}
              description={t('moderation.photosEmptyDescription')}
              compact
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {photos.map((p) => (
              <PhotoCard key={p._id} photo={p} />
            ))}
          </div>
        )}
      </AdminSection>

      <AdminSection
        title={t('moderation.templatesHeading', { count: templates.length })}
        description={t('moderation.templatesDescription')}
        bare
      >
        <AdminDataTable
          rows={templates}
          columns={templateColumns}
          getRowId={(tpl) => tpl._id}
          searchable={(tpl) => `${tpl.name} ${tpl.bodyText} ${tpl.ctaLabel} ${tpl.status}`}
          initialSort={{ id: 'submittedAt', dir: 'desc' }}
          emptyTitle={t('moderation.templatesEmpty')}
          emptyDescription={t('moderation.templatesEmptyDescription')}
          emptyIcon={MessageSquare}
        />
      </AdminSection>
    </div>
  );
}

function PhotoCard({ photo }: { photo: Photo }) {
  const t = useTranslations('Admin');
  const { execute: moderate, loading } = useServerAction(adminModeratePhotoAction);

  const thumbUrl = photo.variants?.thumb ?? photo.variants?.medium;
  const sizeKb = Math.round(photo.sizeBytes / 1024);

  return (
    <figure className="flex flex-col gap-3 overflow-hidden rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3">
      {thumbUrl ? (
        /* eslint-disable-next-line @next/next/no-img-element -- URL CloudFront signée, hors loader Next */
        <img
          src={thumbUrl}
          alt={t('moderation.photoAlt')}
          className="aspect-[4/3] w-full rounded-lg object-cover"
        />
      ) : (
        <div className="flex aspect-[4/3] items-center justify-center rounded-lg bg-[color:var(--color-surface-elevated)] text-xs text-[color:var(--color-muted-foreground)]">
          {t('moderation.noPreview')}
        </div>
      )}
      <figcaption className="flex flex-col gap-0.5 text-xs text-[color:var(--color-muted-foreground)]">
        <span className="truncate text-[color:var(--color-foreground)]">
          {photo.uploaderName ?? t('moderation.anonymous')}
        </span>
        <span className="font-mono">
          {t('moderation.sizeKb', { size: sizeKb })} · {photo.contentType}
        </span>
      </figcaption>
      {/* Modération sur tokens, pas sur `bg-red-100 text-red-800` : ces classes
          Tailwind brutes posaient une pastille claire sur le back-office sombre. */}
      <div className="flex items-center gap-2">
        <ModerateButton
          tone="approve"
          disabled={loading}
          onClick={() => moderate(photo._id, 'approved')}
        >
          <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
          {t('moderation.approve')}
        </ModerateButton>
        <ModerateButton
          tone="reject"
          disabled={loading}
          onClick={() => moderate(photo._id, 'rejected')}
        >
          <X className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
          {t('moderation.reject')}
        </ModerateButton>
      </div>
    </figure>
  );
}

function ModerateButton({
  tone,
  disabled,
  onClick,
  children,
}: {
  tone: 'approve' | 'reject';
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        'focus-ring inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50',
        tone === 'approve'
          ? 'bg-[color:var(--color-success-soft)] text-[color:color-mix(in_oklab,var(--color-success),var(--color-foreground)_42%)] hover:brightness-110'
          : 'bg-[color:var(--color-danger-soft)] text-[color:color-mix(in_oklab,var(--color-danger),var(--color-foreground)_40%)] hover:brightness-110',
      ].join(' ')}
    >
      {children}
    </button>
  );
}
