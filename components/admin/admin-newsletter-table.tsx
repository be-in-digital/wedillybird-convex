'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Mail } from 'lucide-react';
import { formatDate } from '@/lib/admin/format';
import { AdminDataTable, type AdminColumn } from './ui/data-table';
import { AdminFilterOption, AdminFilterSelect } from './ui/filter-select';
import { StatusPill } from './ui/status-pill';

type Subscriber = {
  _id: string;
  email: string;
  status: 'active' | 'unsubscribed';
  source?: string;
  subscribedAt: number;
  unsubscribedAt?: number;
};

export function AdminNewsletterTable({ subscribers }: { subscribers: Subscriber[] }) {
  const t = useTranslations('Admin');
  const locale = useLocale();
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const filtered = subscribers.filter((s) => statusFilter === 'all' || s.status === statusFilter);

  const columns: AdminColumn<Subscriber>[] = [
    {
      id: 'email',
      header: t('newsletter.colEmail'),
      card: 'title',
      sortValue: (s) => s.email,
      cell: (s) => <span className="font-medium break-all">{s.email}</span>,
    },
    {
      id: 'status',
      header: t('newsletter.colStatus'),
      card: 'badge',
      sortValue: (s) => s.status,
      cell: (s) => (
        <StatusPill tone={s.status === 'active' ? 'success' : 'neutral'}>
          {s.status === 'active'
            ? t('newsletter.statusActive')
            : t('newsletter.statusUnsubscribed')}
        </StatusPill>
      ),
    },
    {
      id: 'source',
      header: t('newsletter.colSource'),
      sortValue: (s) => s.source ?? '',
      cell: (s) => (
        <span className="text-[color:var(--color-muted-foreground)]">{s.source ?? '—'}</span>
      ),
    },
    {
      id: 'subscribedAt',
      header: t('newsletter.colSubscribedAt'),
      sortValue: (s) => s.subscribedAt,
      cell: (s) => (
        <span className="whitespace-nowrap text-[color:var(--color-muted-foreground)]">
          {formatDate(s.subscribedAt, locale)}
        </span>
      ),
    },
    {
      id: 'unsubscribedAt',
      header: t('newsletter.colUnsubscribedAt'),
      sortValue: (s) => s.unsubscribedAt ?? null,
      cell: (s) => (
        <span className="whitespace-nowrap text-[color:var(--color-muted-foreground)]">
          {s.unsubscribedAt ? formatDate(s.unsubscribedAt, locale) : '—'}
        </span>
      ),
      hideBelow: 'lg',
    },
  ];

  return (
    <AdminDataTable
      rows={filtered}
      columns={columns}
      getRowId={(s) => s._id}
      searchable={(s) => `${s.email} ${s.source ?? ''}`}
      searchPlaceholder={t('newsletter.searchPlaceholder')}
      initialSort={{ id: 'subscribedAt', dir: 'desc' }}
      pageSize={50}
      emptyTitle={t('newsletter.emptyTitle')}
      emptyDescription={t('newsletter.emptyDescription')}
      emptyIcon={Mail}
      filters={
        <AdminFilterSelect
          label={t('newsletter.colStatus')}
          value={statusFilter}
          onValueChange={setStatusFilter}
        >
          <AdminFilterOption value="all">{t('newsletter.statusFilterAll')}</AdminFilterOption>
          <AdminFilterOption value="active">{t('newsletter.statusFilterActive')}</AdminFilterOption>
          <AdminFilterOption value="unsubscribed">
            {t('newsletter.statusFilterUnsubscribed')}
          </AdminFilterOption>
        </AdminFilterSelect>
      }
    />
  );
}
