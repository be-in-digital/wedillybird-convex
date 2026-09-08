'use client';

import { Fragment, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ScrollText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatDateTime } from '@/lib/admin/format';
import {
  parseAuditDetails,
  type AuditField,
  type AuditValue,
  type AuditDetails,
} from '@/lib/admin/audit-details';
import { cn } from '@/lib/cn';
import { AdminDataTable, type AdminColumn } from './ui/data-table';

type AuditEntry = {
  _id: string;
  adminName: string | null;
  adminEmail: string | null;
  action: string;
  targetType: string;
  targetId: string;
  details?: string;
  createdAt: number;
};

const TARGET_VARIANT: Record<string, 'neutral' | 'primary' | 'accent' | 'warning'> = {
  user: 'primary',
  event: 'accent',
  payment: 'warning',
  organization: 'neutral',
  photo: 'neutral',
  template: 'neutral',
  newsletter: 'neutral',
};

/** Nombre de champs montrés dans la ligne ; le reste s'ouvre au clic. */
const INLINE_FIELDS = 2;

function Value({ value, className }: { value: AuditValue; className?: string }) {
  return (
    <span
      title={value.title}
      className={cn(
        value.mono && 'font-mono text-[0.8125rem]',
        value.muted && 'text-[color:var(--color-muted-foreground)]',
        className,
      )}
    >
      {value.text}
    </span>
  );
}

/** Un champ en pastille, pour la ligne du tableau. */
function FieldChip({ field }: { field: AuditField }) {
  return (
    <span className="inline-flex max-w-full items-baseline gap-1.5 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)]/40 px-1.5 py-0.5 text-xs whitespace-nowrap">
      <span className="text-[color:var(--color-muted-foreground)]">{field.label}</span>
      {field.kind === 'transition' ? (
        <span className="inline-flex items-baseline gap-1">
          <Value value={field.from} className="text-[color:var(--color-muted-foreground)]" />
          <span aria-hidden className="text-[color:var(--color-muted-foreground)]">
            →
          </span>
          <Value value={field.to} />
        </span>
      ) : field.kind === 'counts' ? (
        <span className="font-mono tabular-nums">{field.total}</span>
      ) : (
        <Value value={field.value} />
      )}
    </span>
  );
}

/** Le détail complet, en liste de définitions. */
function FieldList({ fields }: { fields: readonly AuditField[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
      {fields.map((field) => (
        <Fragment key={field.key}>
          <dt className="text-[0.6875rem] font-semibold tracking-[0.08em] text-[color:var(--color-muted-foreground)] uppercase sm:pt-0.5">
            {field.label}
          </dt>
          <dd className="min-w-0 text-sm break-words">
            {field.kind === 'transition' ? (
              <span className="inline-flex flex-wrap items-baseline gap-1.5">
                <Value value={field.from} className="text-[color:var(--color-muted-foreground)]" />
                <span aria-hidden className="text-[color:var(--color-muted-foreground)]">
                  →
                </span>
                <Value value={field.to} className="font-medium" />
              </span>
            ) : field.kind === 'counts' ? (
              <ul className="flex flex-col gap-1">
                {field.entries.map((entry) => (
                  <li key={entry.label} className="flex items-baseline justify-between gap-4">
                    <span className={cn(entry.mono && 'font-mono text-[0.8125rem]')}>
                      {entry.label}
                    </span>
                    <span className="font-mono tabular-nums">{entry.count}</span>
                  </li>
                ))}
                <li className="mt-1 flex items-baseline justify-between gap-4 border-t border-[color:var(--color-border)] pt-1 font-medium">
                  <span>Total</span>
                  <span className="font-mono tabular-nums">{field.total}</span>
                </li>
              </ul>
            ) : (
              <Value value={field.value} />
            )}
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

/**
 * Cellule « détails » : un résumé cliquable.
 *
 * La colonne était masquée sous `lg` et tronquée au-dessus — autant dire que la
 * charge de l'événement n'était lisible nulle part. Le résumé tient dans la
 * ligne, le reste s'ouvre.
 */
function DetailsCell({ entry, actionLabel }: { entry: AuditEntry; actionLabel: string }) {
  const t = useTranslations('Admin');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const parsed: AuditDetails = parseAuditDetails(entry.details, locale);

  if (parsed.kind === 'empty') {
    return <span className="text-[color:var(--color-muted-foreground)]">—</span>;
  }

  const inline = parsed.kind === 'fields' ? parsed.fields.slice(0, INLINE_FIELDS) : [];
  const hidden = parsed.kind === 'fields' ? parsed.fields.length - inline.length : 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        // Sur la carte mobile les pastilles s'enroulent — les rogner couperait
        // le « +N » qui dit justement qu'il y a autre chose à voir. Dans le
        // tableau, elles tiennent sur une ligne pour ne pas faire danser la
        // hauteur des lignes ; le détail complet est de toute façon à un clic.
        className="focus-ring -mx-1 flex max-w-full flex-wrap items-center gap-1.5 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-[color:var(--color-surface-elevated)] md:flex-nowrap md:overflow-hidden"
      >
        {parsed.kind === 'raw' ? (
          <span className="truncate text-xs text-[color:var(--color-muted-foreground)]">
            {parsed.text}
          </span>
        ) : (
          <>
            {inline.map((field) => (
              <FieldChip key={field.key} field={field} />
            ))}
            {hidden > 0 ? (
              <span className="text-xs whitespace-nowrap text-[color:var(--color-muted-foreground)]">
                +{hidden}
              </span>
            ) : null}
          </>
        )}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{actionLabel}</DialogTitle>
            <DialogDescription>
              {formatDateTime(entry.createdAt, locale)} ·{' '}
              {entry.adminName ?? entry.adminEmail ?? '—'}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)]/40 px-3 py-2 text-sm">
              <span className="text-[color:var(--color-muted-foreground)]">
                {t('auditLog.colTarget')}
              </span>
              <Badge variant={TARGET_VARIANT[entry.targetType] ?? 'neutral'}>
                {entry.targetType}
              </Badge>
              {/* Identifiant entier et sélectionnable : c'est ce qu'on recopie
                  pour aller vérifier l'objet ailleurs. */}
              <span className="font-mono text-xs break-all select-all">{entry.targetId}</span>
            </div>

            {parsed.kind === 'fields' ? (
              <FieldList fields={parsed.fields} />
            ) : (
              <pre className="overflow-x-auto rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)]/40 p-3 font-mono text-xs whitespace-pre-wrap">
                {parsed.text}
              </pre>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function AdminAuditLogTable({ logs }: { logs: AuditEntry[] }) {
  const t = useTranslations('Admin');
  const locale = useLocale();

  const actionLabel = (l: AuditEntry) =>
    t.has(`auditActions.${l.action}`) ? t(`auditActions.${l.action}`) : l.action;

  const columns: AdminColumn<AuditEntry>[] = [
    {
      id: 'date',
      header: t('auditLog.colDate'),
      sortValue: (l) => l.createdAt,
      cell: (l) => (
        <span className="whitespace-nowrap text-[color:var(--color-muted-foreground)]">
          {formatDateTime(l.createdAt, locale)}
        </span>
      ),
    },
    {
      id: 'admin',
      header: t('auditLog.colAdmin'),
      sortValue: (l) => l.adminName ?? l.adminEmail ?? '',
      cell: (l) => <span className="font-medium">{l.adminName ?? l.adminEmail ?? '—'}</span>,
    },
    {
      id: 'action',
      header: t('auditLog.colAction'),
      card: 'title',
      sortValue: (l) => l.action,
      cell: actionLabel,
    },
    {
      id: 'target',
      header: t('auditLog.colTarget'),
      card: 'badge',
      sortValue: (l) => l.targetType,
      cell: (l) => (
        <span className="inline-flex items-center gap-2">
          <Badge variant={TARGET_VARIANT[l.targetType] ?? 'neutral'}>{l.targetType}</Badge>
          <span
            title={l.targetId}
            className="font-mono text-xs text-[color:var(--color-muted-foreground)]"
          >
            {l.targetId.slice(0, 12)}…
          </span>
        </span>
      ),
    },
    {
      id: 'details',
      header: t('auditLog.colDetails'),
      // `actions` et non `meta` : la case `meta` de la carte mobile est en
      // `truncate`, qui couperait les pastilles. Et c'est bien une action —
      // le résumé s'ouvre.
      card: 'actions',
      cell: (l) => <DetailsCell entry={l} actionLabel={actionLabel(l)} />,
      hideBelow: 'lg',
      className: 'max-w-[24rem]',
    },
  ];

  return (
    <AdminDataTable
      rows={logs}
      columns={columns}
      getRowId={(l) => l._id}
      searchable={(l) =>
        `${l.adminName ?? ''} ${l.adminEmail ?? ''} ${l.action} ${l.targetType} ${l.targetId} ${l.details ?? ''}`
      }
      initialSort={{ id: 'date', dir: 'desc' }}
      pageSize={50}
      emptyTitle={t('auditLog.empty')}
      emptyDescription={t('auditLog.emptyDescription')}
      emptyIcon={ScrollText}
    />
  );
}
