'use client';

import { useLocale, useTranslations } from 'next-intl';
import { ScrollText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatDateTime } from '@/lib/admin/format';
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

export function AdminAuditLogTable({ logs }: { logs: AuditEntry[] }) {
  const t = useTranslations('Admin');
  const locale = useLocale();

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
      cell: (l) => (t.has(`auditActions.${l.action}`) ? t(`auditActions.${l.action}`) : l.action),
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
      className: 'max-w-xs truncate text-xs text-[color:var(--color-muted-foreground)]',
      cell: (l) => <span title={l.details ?? undefined}>{l.details ?? '—'}</span>,
      hideBelow: 'lg',
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
