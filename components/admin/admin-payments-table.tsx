'use client';

import { useState, useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CreditCard, FileDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { currencyDivisor, formatDateTime, formatMoneyMinor } from '@/lib/admin/format';
import { adminRefundPaymentAction } from '@/app/[locale]/(app)/admin/actions';
import { AdminDataTable, type AdminColumn } from './ui/data-table';
import { AdminFilterOption, AdminFilterSelect } from './ui/filter-select';
import { StatusPill, type StatusTone } from './ui/status-pill';

type Payment = {
  _id: string;
  kind?: 'plan' | 'post_event_upsell';
  plan?: 'essential' | 'premium';
  currency: 'EUR' | 'USD' | 'XOF' | 'MAD' | 'TND';
  amountMinor: number;
  provider: 'stripe' | 'mock';
  status: 'pending' | 'succeeded' | 'failed' | 'cancelled' | 'refunded' | 'partially_refunded';
  failureReason?: string;
  refundedAmountMinor?: number;
  refundedAt?: number;
  userName: string | null;
  userEmail: string | null;
  eventId: string;
  createdAt: number;
  updatedAt: number;
};

const STATUS_TONE: Record<Payment['status'], StatusTone> = {
  pending: 'warning',
  succeeded: 'success',
  failed: 'danger',
  cancelled: 'neutral',
  refunded: 'info',
  partially_refunded: 'warning',
};

export function AdminPaymentsTable({ payments }: { payments: Payment[] }) {
  const t = useTranslations('Admin');
  const locale = useLocale();
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [currencyFilter, setCurrencyFilter] = useState<string>('all');

  const filtered = payments.filter(
    (p) =>
      (statusFilter === 'all' || p.status === statusFilter) &&
      (currencyFilter === 'all' || p.currency === currencyFilter),
  );

  const columns: AdminColumn<Payment>[] = [
    {
      id: 'client',
      header: t('payments.colClient'),
      card: 'title',
      sortValue: (p) => p.userName ?? p.userEmail ?? '',
      cell: (p) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{p.userName ?? p.userEmail ?? '—'}</p>
          {p.userName && p.userEmail ? (
            <p className="truncate text-xs text-[color:var(--color-muted-foreground)]">
              {p.userEmail}
            </p>
          ) : null}
        </div>
      ),
    },
    {
      id: 'plan',
      header: t('payments.colPlan'),
      cell: (p) =>
        p.plan ? (
          <Badge variant={p.plan === 'premium' ? 'primary' : 'neutral'}>{p.plan}</Badge>
        ) : (
          <Badge variant="neutral">{p.kind === 'post_event_upsell' ? 'Upsell HD' : '—'}</Badge>
        ),
      sortValue: (p) => p.plan ?? p.kind ?? '',
      hideBelow: 'lg',
    },
    {
      id: 'amount',
      header: t('payments.colAmount'),
      align: 'right',
      // Tri sur le montant brut : trier sur la chaîne formatée classerait
      // « 1 000 € » avant « 90 € ».
      sortValue: (p) => p.amountMinor / currencyDivisor(p.currency),
      cell: (p) => {
        const refunded = p.refundedAmountMinor ?? 0;
        return (
          <span className="font-mono whitespace-nowrap tabular-nums">
            {formatMoneyMinor(p.amountMinor, p.currency, locale)}
            {refunded > 0 ? (
              <span className="ml-1 text-[0.6875rem] text-[color:var(--color-muted-foreground)]">
                (−{formatMoneyMinor(refunded, p.currency, locale)})
              </span>
            ) : null}
          </span>
        );
      },
    },
    {
      id: 'provider',
      header: t('payments.colProvider'),
      sortValue: (p) => p.provider,
      cell: (p) => <span className="text-[color:var(--color-muted-foreground)]">{p.provider}</span>,
      hideBelow: 'xl',
    },
    {
      id: 'status',
      header: t('payments.colStatus'),
      card: 'badge',
      sortValue: (p) => p.status,
      cell: (p) => (
        <StatusPill tone={STATUS_TONE[p.status] ?? 'neutral'}>
          {t.has(`paymentStatuses.${p.status}`) ? t(`paymentStatuses.${p.status}`) : p.status}
        </StatusPill>
      ),
    },
    {
      id: 'date',
      header: t('payments.colDate'),
      sortValue: (p) => p.createdAt,
      cell: (p) => (
        <span className="whitespace-nowrap text-[color:var(--color-muted-foreground)]">
          {formatDateTime(p.createdAt, locale)}
        </span>
      ),
    },
    {
      id: 'actions',
      header: t('common.colActions'),
      card: 'actions',
      align: 'right',
      className: 'whitespace-nowrap',
      cell: (p) => <PaymentActions payment={p} />,
    },
  ];

  return (
    <AdminDataTable
      rows={filtered}
      columns={columns}
      getRowId={(p) => p._id}
      searchable={(p) => `${p.userName ?? ''} ${p.userEmail ?? ''} ${p.plan ?? ''} ${p.provider}`}
      initialSort={{ id: 'date', dir: 'desc' }}
      emptyTitle={t('payments.emptyTitle')}
      emptyDescription={t('payments.emptyDescription')}
      emptyIcon={CreditCard}
      filters={
        <>
          <AdminFilterSelect
            label={t('payments.colStatus')}
            value={statusFilter}
            onValueChange={setStatusFilter}
          >
            <AdminFilterOption value="all">{t('payments.statusFilterAll')}</AdminFilterOption>
            <AdminFilterOption value="succeeded">
              {t('paymentStatuses.succeeded')}
            </AdminFilterOption>
            <AdminFilterOption value="pending">{t('paymentStatuses.pending')}</AdminFilterOption>
            <AdminFilterOption value="failed">{t('paymentStatuses.failed')}</AdminFilterOption>
            <AdminFilterOption value="cancelled">
              {t('paymentStatuses.cancelled')}
            </AdminFilterOption>
            <AdminFilterOption value="refunded">{t('paymentStatuses.refunded')}</AdminFilterOption>
            <AdminFilterOption value="partially_refunded">
              {t('paymentStatuses.partially_refunded')}
            </AdminFilterOption>
          </AdminFilterSelect>
          <AdminFilterSelect
            label={t('payments.colAmount')}
            value={currencyFilter}
            onValueChange={setCurrencyFilter}
            widthClassName="w-full sm:w-auto sm:min-w-[8.5rem]"
          >
            <AdminFilterOption value="all">{t('payments.currencyFilterAll')}</AdminFilterOption>
            <AdminFilterOption value="EUR">EUR</AdminFilterOption>
            <AdminFilterOption value="USD">USD</AdminFilterOption>
            <AdminFilterOption value="XOF">XOF</AdminFilterOption>
            <AdminFilterOption value="MAD">MAD</AdminFilterOption>
            <AdminFilterOption value="TND">TND</AdminFilterOption>
          </AdminFilterSelect>
        </>
      }
    />
  );
}

function PaymentActions({ payment: p }: { payment: Payment }) {
  const t = useTranslations('Admin');
  const refunded = p.refundedAmountMinor ?? 0;
  const remaining = p.amountMinor - refunded;
  const canRefund =
    (p.status === 'succeeded' || p.status === 'partially_refunded') && remaining > 0;
  const hasInvoice =
    p.status === 'succeeded' || p.status === 'partially_refunded' || p.status === 'refunded';

  if (!hasInvoice && !canRefund) {
    return <span className="text-xs text-[color:var(--color-muted-foreground)]">—</span>;
  }

  return (
    <div className="flex items-center justify-end gap-1">
      {hasInvoice ? (
        <a
          href={`/api/payments/${p._id}/invoice.pdf`}
          target="_blank"
          rel="noopener noreferrer"
          className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-surface-elevated)] hover:text-[color:var(--color-foreground)]"
        >
          <FileDown className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
          {t('payments.invoice')}
        </a>
      ) : null}
      {canRefund ? <RefundDialog payment={p} remaining={remaining} /> : null}
    </div>
  );
}

function RefundDialog({ payment: p, remaining }: { payment: Payment; remaining: number }) {
  const t = useTranslations('Admin');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [partial, setPartial] = useState(false);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const div = currencyDivisor(p.currency);
  const maxMajor = remaining / div;

  function submit() {
    setError(null);
    let amountMinor: number | undefined;
    if (partial) {
      const major = Number(amount.replace(',', '.'));
      if (!Number.isFinite(major) || major <= 0) {
        setError(t('payments.refund.errorInvalidAmount'));
        return;
      }
      amountMinor = Math.round(major * div);
      if (amountMinor > remaining) {
        setError(t('payments.refund.errorExceedsRemaining'));
        return;
      }
    }
    startTransition(async () => {
      const res = await adminRefundPaymentAction(p._id, amountMinor);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      setPartial(false);
      setAmount('');
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="focus-ring inline-flex h-8 items-center rounded-md px-2 text-xs font-medium text-[color:var(--color-danger)] transition-colors hover:bg-[color:var(--color-danger-soft)]"
        >
          {t('payments.refund.trigger')}
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('payments.refund.title')}</DialogTitle>
          <DialogDescription>
            {t.rich('payments.refund.description', {
              client: p.userName ?? p.userEmail ?? t('payments.clientFallback'),
              plan: p.plan ?? 'Upsell HD',
              amount: formatMoneyMinor(remaining, p.currency, locale),
              mono: (chunks) => <span className="font-mono">{chunks}</span>,
            })}{' '}
            {p.provider === 'mock'
              ? t('payments.refund.providerNoteMock')
              : t('payments.refund.providerNoteStripe')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <label className="flex cursor-pointer items-center gap-2.5 text-sm">
            <Checkbox
              checked={partial}
              onCheckedChange={(checked) => setPartial(checked === true)}
            />
            {t('payments.refund.partialLabel')}
          </label>

          {partial ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={maxMajor.toFixed(div === 1 ? 0 : 2)}
                aria-label={t('payments.refund.partialLabel')}
                className="focus-ring w-32 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2 font-mono text-sm text-[color:var(--color-foreground)]"
              />
              <span className="font-mono text-xs text-[color:var(--color-muted-foreground)]">
                {p.currency}
              </span>
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="text-sm text-[color:var(--color-danger)]">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" size="sm" type="button" disabled={pending}>
              {t('common.cancel')}
            </Button>
          </DialogClose>
          <Button variant="destructive" size="sm" type="button" onClick={submit} disabled={pending}>
            {pending
              ? t('payments.refund.submitting')
              : partial
                ? t('payments.refund.submitPartial')
                : t('payments.refund.submitFull', {
                    amount: formatMoneyMinor(remaining, p.currency, locale),
                  })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
