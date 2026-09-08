'use client';

import { useLocale, useTranslations } from 'next-intl';
import { FileDown, FileText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { currencyDivisor, formatDate, formatMoneyMinor } from '@/lib/admin/format';
import { AdminDataTable, type AdminColumn } from './ui/data-table';
import { StatusPill, type StatusTone } from './ui/status-pill';

type Payment = {
  _id: string;
  kind?: 'plan' | 'post_event_upsell';
  plan?: 'essential' | 'premium';
  currency: 'EUR' | 'USD' | 'XOF' | 'MAD' | 'TND';
  amountMinor: number;
  status: 'pending' | 'succeeded' | 'failed' | 'cancelled' | 'refunded' | 'partially_refunded';
  refundedAmountMinor?: number;
  userName: string | null;
  userEmail: string | null;
  createdAt: number;
};

const STATUS_TONE: Record<string, StatusTone> = {
  succeeded: 'success',
  refunded: 'info',
  partially_refunded: 'warning',
};

/**
 * Factures one-shot plateforme (Essentiel / Premium). Chaque paiement encaissé
 * a une facture PDF générée à la volée par `/api/payments/{id}/invoice.pdf`.
 * Les factures d'abonnement Stripe sont consultables par organisation depuis
 * la section Abonnements (bouton « Factures »).
 */
export function AdminInvoicesTable({ payments }: { payments: Payment[] }) {
  const t = useTranslations('Admin');
  const locale = useLocale();

  // Seuls les paiements encaissés (et leurs avatars remboursés) ont une facture.
  const invoiced = payments.filter(
    (p) => p.status === 'succeeded' || p.status === 'refunded' || p.status === 'partially_refunded',
  );

  const columns: AdminColumn<Payment>[] = [
    {
      id: 'client',
      header: t('invoices.colClient'),
      card: 'title',
      sortValue: (p) => p.userName ?? p.userEmail ?? '',
      cell: (p) => <span className="font-medium">{p.userName ?? p.userEmail ?? '—'}</span>,
    },
    {
      id: 'plan',
      header: t('invoices.colPlan'),
      sortValue: (p) => p.plan ?? p.kind ?? '',
      cell: (p) => (
        <Badge variant={p.plan === 'premium' ? 'primary' : 'neutral'}>
          {p.plan ?? (p.kind === 'post_event_upsell' ? 'Upsell HD' : '—')}
        </Badge>
      ),
      hideBelow: 'lg',
    },
    {
      id: 'amount',
      header: t('invoices.colAmount'),
      align: 'right',
      sortValue: (p) => p.amountMinor / currencyDivisor(p.currency),
      cell: (p) => (
        <span className="font-mono whitespace-nowrap tabular-nums">
          {formatMoneyMinor(p.amountMinor, p.currency, locale)}
        </span>
      ),
    },
    {
      id: 'status',
      header: t('invoices.colStatus'),
      card: 'badge',
      sortValue: (p) => p.status,
      cell: (p) => (
        <StatusPill tone={STATUS_TONE[p.status] ?? 'neutral'}>
          {t.has(`invoiceStatuses.${p.status}`) ? t(`invoiceStatuses.${p.status}`) : p.status}
        </StatusPill>
      ),
    },
    {
      id: 'date',
      header: t('invoices.colDate'),
      sortValue: (p) => p.createdAt,
      cell: (p) => (
        <span className="whitespace-nowrap text-[color:var(--color-muted-foreground)]">
          {formatDate(p.createdAt, locale)}
        </span>
      ),
    },
    {
      id: 'invoice',
      header: t('invoices.colInvoice'),
      card: 'actions',
      align: 'right',
      width: 'w-32',
      cell: (p) => (
        <a
          href={`/api/payments/${p._id}/invoice.pdf`}
          target="_blank"
          rel="noopener noreferrer"
          className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-[color:var(--color-primary)] transition-colors hover:bg-[color:var(--color-surface-elevated)]"
        >
          <FileDown className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
          {t('invoices.downloadPdf')}
        </a>
      ),
    },
  ];

  return (
    <AdminDataTable
      rows={invoiced}
      columns={columns}
      getRowId={(p) => p._id}
      searchable={(p) => `${p.userName ?? ''} ${p.userEmail ?? ''} ${p.plan ?? ''}`}
      searchPlaceholder={t('invoices.searchPlaceholder')}
      initialSort={{ id: 'date', dir: 'desc' }}
      emptyTitle={t('invoices.emptyTitle')}
      emptyDescription={t('invoices.emptyDescription')}
      emptyIcon={FileText}
    />
  );
}
