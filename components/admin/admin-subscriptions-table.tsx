'use client';

import { useState, useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Building2 } from 'lucide-react';
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
import { formatDate, formatMoneyMinor } from '@/lib/admin/format';
import {
  adminCancelSubscriptionAction,
  adminReactivateSubscriptionAction,
  adminListOrgInvoicesAction,
  type OrgInvoicesResult,
} from '@/app/[locale]/(app)/admin/actions';
import { AdminDataTable, type AdminColumn } from './ui/data-table';
import { StatusPill, type StatusTone } from './ui/status-pill';

type Org = {
  _id: string;
  name: string;
  slug: string;
  subscriptionTier?: string;
  subscriptionStatus?: string;
  subscriptionPeriodEnd?: number;
  paygCredits?: number;
  hasStripeSubscription?: boolean;
  hasStripeCustomer?: boolean;
  ownerName: string | null;
  ownerEmail: string | null;
  createdAt: number;
};

const STATUS_TONE: Record<string, StatusTone> = {
  active: 'success',
  trialing: 'progress',
  past_due: 'warning',
  canceled: 'danger',
  unpaid: 'danger',
};

export function AdminSubscriptionsTable({ organizations }: { organizations: Org[] }) {
  const t = useTranslations('Admin');
  const locale = useLocale();

  const columns: AdminColumn<Org>[] = [
    {
      id: 'org',
      header: t('subscriptions.colOrg'),
      card: 'title',
      sortValue: (o) => o.name,
      cell: (o) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{o.name}</p>
          <p className="truncate font-mono text-xs text-[color:var(--color-muted-foreground)]">
            {o.slug}
          </p>
        </div>
      ),
    },
    {
      id: 'owner',
      header: t('subscriptions.colOwner'),
      sortValue: (o) => o.ownerName ?? o.ownerEmail ?? '',
      cell: (o) => (
        <span className="truncate text-[color:var(--color-muted-foreground)]">
          {o.ownerName ?? o.ownerEmail ?? '—'}
        </span>
      ),
      hideBelow: 'lg',
    },
    {
      id: 'tier',
      header: t('subscriptions.colTier'),
      sortValue: (o) => o.subscriptionTier ?? '',
      cell: (o) =>
        o.subscriptionTier ? (
          <Badge variant="accent">{o.subscriptionTier}</Badge>
        ) : (
          <span className="text-[color:var(--color-muted-foreground)]">—</span>
        ),
    },
    {
      id: 'status',
      header: t('subscriptions.colStatus'),
      card: 'badge',
      sortValue: (o) => o.subscriptionStatus ?? '',
      cell: (o) =>
        o.subscriptionStatus ? (
          <StatusPill tone={STATUS_TONE[o.subscriptionStatus] ?? 'neutral'}>
            {o.subscriptionStatus}
          </StatusPill>
        ) : (
          <span className="text-[color:var(--color-muted-foreground)]">—</span>
        ),
    },
    {
      id: 'renewal',
      header: t('subscriptions.colRenewal'),
      sortValue: (o) => o.subscriptionPeriodEnd ?? null,
      cell: (o) => (
        <span className="whitespace-nowrap text-[color:var(--color-muted-foreground)]">
          {o.subscriptionPeriodEnd ? formatDate(o.subscriptionPeriodEnd, locale) : '—'}
        </span>
      ),
    },
    {
      id: 'payg',
      header: t('subscriptions.colPaygCredits'),
      align: 'right',
      sortValue: (o) => o.paygCredits ?? 0,
      cell: (o) => <span className="font-mono tabular-nums">{o.paygCredits ?? 0}</span>,
      hideBelow: 'xl',
    },
    {
      id: 'actions',
      header: t('common.colActions'),
      card: 'actions',
      align: 'right',
      width: 'w-44',
      cell: (o) => <OrgActions org={o} />,
    },
  ];

  return (
    <AdminDataTable
      rows={organizations}
      columns={columns}
      getRowId={(o) => o._id}
      searchable={(o) => `${o.name} ${o.slug} ${o.ownerName ?? ''} ${o.ownerEmail ?? ''}`}
      searchPlaceholder={t('subscriptions.searchPlaceholder')}
      initialSort={{ id: 'org', dir: 'asc' }}
      emptyTitle={t('subscriptions.emptyTitle')}
      emptyDescription={t('subscriptions.emptyDescription')}
      emptyIcon={Building2}
    />
  );
}

function OrgActions({ org: o }: { org: Org }) {
  const isCanceled = o.subscriptionStatus === 'canceled';
  const hasSub = Boolean(o.hasStripeSubscription);

  if (!o.hasStripeCustomer && !hasSub) {
    return <span className="text-xs text-[color:var(--color-muted-foreground)]">—</span>;
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      {o.hasStripeCustomer ? <InvoicesDialog org={o} /> : null}
      {hasSub && !isCanceled ? <CancelDialog org={o} /> : null}
      {hasSub && isCanceled ? <ReactivateButton org={o} /> : null}
    </div>
  );
}

function CancelDialog({ org: o }: { org: Org }) {
  const t = useTranslations('Admin');
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'period_end' | 'immediate'>('period_end');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await adminCancelSubscriptionAction(o._id, mode);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="focus-ring inline-flex h-8 items-center rounded-md px-2 text-xs font-medium text-[color:var(--color-danger)] transition-colors hover:bg-[color:var(--color-danger-soft)]"
        >
          {t('common.cancel')}
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('subscriptions.cancel.title')}</DialogTitle>
          <DialogDescription>
            {t('subscriptions.cancel.description', {
              name: o.name,
              tier: o.subscriptionTier ?? t('subscriptions.cancel.tierFallback'),
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-[color:var(--color-border)] p-3 text-sm transition-colors hover:border-[color:var(--color-border-strong)]">
            <input
              type="radio"
              name={`cancel-mode-${o._id}`}
              checked={mode === 'period_end'}
              onChange={() => setMode('period_end')}
              className="mt-0.5 h-4 w-4 accent-[color:var(--color-primary)]"
            />
            <span>
              <span className="font-medium">{t('subscriptions.cancel.periodEndTitle')}</span>
              <span className="block text-xs text-[color:var(--color-muted-foreground)]">
                {t('subscriptions.cancel.periodEndDescription')}
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-[color:var(--color-border)] p-3 text-sm transition-colors hover:border-[color:var(--color-border-strong)]">
            <input
              type="radio"
              name={`cancel-mode-${o._id}`}
              checked={mode === 'immediate'}
              onChange={() => setMode('immediate')}
              className="mt-0.5 h-4 w-4 accent-[color:var(--color-primary)]"
            />
            <span>
              <span className="font-medium">{t('subscriptions.cancel.immediateTitle')}</span>
              <span className="block text-xs text-[color:var(--color-muted-foreground)]">
                {t('subscriptions.cancel.immediateDescription')}
              </span>
            </span>
          </label>
        </div>

        {error ? <p className="mt-3 text-sm text-[color:var(--color-danger)]">{error}</p> : null}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" size="sm" type="button" disabled={pending}>
              {t('common.back')}
            </Button>
          </DialogClose>
          <Button variant="destructive" size="sm" type="button" onClick={submit} disabled={pending}>
            {pending ? t('subscriptions.cancel.submitting') : t('subscriptions.cancel.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReactivateButton({ org: o }: { org: Org }) {
  const t = useTranslations('Admin');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reactivate() {
    setError(null);
    startTransition(async () => {
      const res = await adminReactivateSubscriptionAction(o._id);
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <span className="flex items-center gap-1">
      <button
        type="button"
        onClick={reactivate}
        disabled={pending}
        className="focus-ring inline-flex h-8 items-center rounded-md px-2 text-xs font-medium text-[color:var(--color-success)] transition-colors hover:bg-[color:var(--color-success-soft)] disabled:opacity-50"
      >
        {pending ? t('subscriptions.reactivate.submitting') : t('subscriptions.reactivate.submit')}
      </button>
      {error ? <span className="text-[10px] text-[color:var(--color-danger)]">{error}</span> : null}
    </span>
  );
}

function InvoicesDialog({ org: o }: { org: Org }) {
  const t = useTranslations('Admin');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<OrgInvoicesResult | null>(null);
  const [pending, startTransition] = useTransition();

  function load() {
    setOpen(true);
    if (data) return;
    startTransition(async () => {
      const res = await adminListOrgInvoicesAction(o._id);
      setData(res);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? load() : setOpen(false))}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="focus-ring inline-flex h-8 items-center rounded-md px-2 text-xs font-medium text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-surface-elevated)] hover:text-[color:var(--color-foreground)]"
        >
          {t('subscriptions.invoices.trigger')}
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('subscriptions.invoices.title', { name: o.name })}</DialogTitle>
          <DialogDescription>{t('subscriptions.invoices.description')}</DialogDescription>
        </DialogHeader>

        {pending ? (
          <p className="text-sm text-[color:var(--color-muted-foreground)]">
            {t('common.loading')}
          </p>
        ) : data && !data.ok ? (
          <p className="text-sm text-[color:var(--color-danger)]">{data.error}</p>
        ) : data && data.ok && data.invoices.length === 0 ? (
          <p className="text-sm text-[color:var(--color-muted-foreground)]">
            {t('subscriptions.invoices.empty')}
          </p>
        ) : data && data.ok ? (
          <div className="flex flex-col divide-y divide-[color:var(--color-border)]">
            {data.invoices.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <div>
                  <p className="font-mono">{inv.id}</p>
                  <p className="text-xs text-[color:var(--color-muted-foreground)]">
                    {formatDate(inv.date, locale)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono tabular-nums">
                    {formatMoneyMinor(inv.amountMinor, inv.currency, locale)}
                  </span>
                  <Badge variant={inv.status === 'paid' ? 'success' : 'neutral'}>
                    {t.has(`stripeInvoiceStatuses.${inv.status}`)
                      ? t(`stripeInvoiceStatuses.${inv.status}`)
                      : inv.status}
                  </Badge>
                  {inv.pdfUrl ? (
                    <a
                      href={inv.pdfUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-medium text-[color:var(--color-primary)] hover:underline"
                    >
                      PDF
                    </a>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" size="sm" type="button">
              {t('common.close')}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
