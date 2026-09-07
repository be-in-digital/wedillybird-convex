'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useServerAction } from '@/components/admin/use-admin-action';
import {
  adminUpdateEventStatusAction,
  adminDeleteEventAction,
  adminGrantEventPlanAction,
  adminRevokeEventPlanAction,
} from '@/app/[locale]/(app)/admin/actions';

type Event = {
  _id: string;
  title: string;
  coupleNames: { partnerA: string; partnerB: string };
  eventDate: number;
  timezone: string;
  status: 'draft' | 'active' | 'archived' | 'cancelled';
  planTier?: string;
  /** Forfait offert par l'équipe (non payé) — cf. `admin:grantEventPlan`. */
  comped?: { grantedAt: number } | null;
  maxGuests: number;
  ownerName: string | null;
  ownerEmail: string | null;
  organizationId?: string;
  createdAt: number;
  updatedAt: number;
};

const STATUS_VARIANT: Record<string, 'neutral' | 'success' | 'warning' | 'destructive'> = {
  draft: 'neutral',
  active: 'success',
  archived: 'warning',
  cancelled: 'destructive',
};

export function AdminEventsTable({ events }: { events: Event[] }) {
  const t = useTranslations('Admin');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const filtered = events.filter((e) => {
    const matchSearch =
      !search ||
      e.title.toLowerCase().includes(search.toLowerCase()) ||
      e.coupleNames.partnerA.toLowerCase().includes(search.toLowerCase()) ||
      e.coupleNames.partnerB.toLowerCase().includes(search.toLowerCase()) ||
      e.ownerEmail?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || e.status === statusFilter;
    return matchSearch && matchStatus;
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder={t('events.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2 text-sm text-[color:var(--color-foreground)] placeholder:text-[color:var(--color-muted-foreground)] focus:ring-1 focus:ring-[color:var(--color-border-strong)] focus:outline-none"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2 text-sm text-[color:var(--color-foreground)]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('events.statusFilterAll')}</SelectItem>
            <SelectItem value="draft">{t('eventStatuses.draft')}</SelectItem>
            <SelectItem value="active">{t('eventStatuses.active')}</SelectItem>
            <SelectItem value="archived">{t('eventStatuses.archived')}</SelectItem>
            <SelectItem value="cancelled">{t('eventStatuses.cancelled')}</SelectItem>
          </SelectContent>
        </Select>
        <span className="font-mono text-xs text-[color:var(--color-muted-foreground)]">
          {t('events.count', { count: filtered.length })}
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[color:var(--color-border)]">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-[color:var(--color-border)] bg-[color:var(--color-surface)]">
              <Th>{t('events.colCouple')}</Th>
              <Th>{t('events.colTitle')}</Th>
              <Th>{t('events.colDate')}</Th>
              <Th>{t('events.colStatus')}</Th>
              <Th>{t('events.colPlan')}</Th>
              <Th>{t('events.colOwner')}</Th>
              <Th>{t('common.colActions')}</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => (
              <EventRow key={e._id} event={e} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-3 text-left font-mono text-[10px] tracking-[0.2em] text-[color:var(--color-muted-foreground)] uppercase">
      {children}
    </th>
  );
}

function EventRow({ event }: { event: Event }) {
  const t = useTranslations('Admin');
  const locale = useLocale();
  const { execute: updateStatus, loading: updating } = useServerAction(
    adminUpdateEventStatusAction,
  );
  const { execute: deleteEvent, loading: deleting } = useServerAction(adminDeleteEventAction);
  const { execute: grantPlan, loading: granting } = useServerAction(adminGrantEventPlanAction);
  const { execute: revokePlan, loading: revoking } = useServerAction(adminRevokeEventPlanAction);
  const { confirm, confirmDialog } = useConfirm();

  return (
    <>
      <tr className="border-b border-[color:var(--color-border)] last:border-0 hover:bg-[color:var(--color-surface-elevated)]/50">
        <td className="px-4 py-3 font-medium">
          {event.coupleNames.partnerA} & {event.coupleNames.partnerB}
        </td>
        <td className="px-4 py-3 text-[color:var(--color-muted-foreground)]">{event.title}</td>
        <td className="px-4 py-3 text-[color:var(--color-muted-foreground)]">
          {new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
            new Date(event.eventDate),
          )}
        </td>
        <td className="px-4 py-3">
          <Badge variant={STATUS_VARIANT[event.status] ?? 'neutral'}>{event.status}</Badge>
        </td>
        <td className="px-4 py-3 text-[color:var(--color-muted-foreground)]">
          <span className="flex flex-wrap items-center gap-1.5">
            {event.planTier ?? '—'}
            {event.comped ? <Badge variant="warning">{t('events.compedBadge')}</Badge> : null}
          </span>
        </td>
        <td className="px-4 py-3 text-[color:var(--color-muted-foreground)]">
          {event.ownerName ?? event.ownerEmail ?? '—'}
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <Select
              value=""
              disabled={updating}
              onValueChange={async (v) => {
                const newStatus = v as Event['status'];
                if (
                  await confirm({ title: t('events.confirmChangeStatus', { status: newStatus }) })
                ) {
                  updateStatus(event._id, newStatus);
                }
              }}
            >
              <SelectTrigger className="rounded-md border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-xs text-[color:var(--color-muted-foreground)]">
                <SelectValue placeholder={t('events.statusPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">{t('eventStatuses.draft')}</SelectItem>
                <SelectItem value="active">{t('eventStatuses.active')}</SelectItem>
                <SelectItem value="archived">{t('eventStatuses.archived')}</SelectItem>
                <SelectItem value="cancelled">{t('eventStatuses.cancelled')}</SelectItem>
              </SelectContent>
            </Select>
            {/* Forfait offert : la seule façon de donner un accès Premium sans
                transaction Stripe (partenariat, démo). La révocation n'est
                proposée que sur un forfait effectivement offert — le serveur
                refuse de toute façon sur un event payé. */}
            {event.comped ? (
              <button
                onClick={async () => {
                  if (await confirm({ title: t('events.confirmRevokePlan'), destructive: true })) {
                    revokePlan(event._id, undefined);
                  }
                }}
                disabled={revoking}
                className="rounded-md px-2 py-1 text-xs font-medium text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-surface-elevated)] disabled:opacity-50"
              >
                {t('events.revokePlan')}
              </button>
            ) : (
              <Select
                value=""
                disabled={granting}
                onValueChange={async (v) => {
                  const tier = v as 'essential' | 'premium';
                  if (await confirm({ title: t('events.confirmGrantPlan', { plan: tier }) })) {
                    grantPlan(event._id, tier, undefined);
                  }
                }}
              >
                <SelectTrigger className="rounded-md border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-xs text-[color:var(--color-muted-foreground)]">
                  <SelectValue placeholder={t('events.grantPlanPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="essential">{t('events.grantEssential')}</SelectItem>
                  <SelectItem value="premium">{t('events.grantPremium')}</SelectItem>
                </SelectContent>
              </Select>
            )}
            {event.status !== 'cancelled' ? (
              <button
                onClick={async () => {
                  if (
                    await confirm({
                      title: t('events.confirmDelete', { title: event.title }),
                      destructive: true,
                    })
                  ) {
                    deleteEvent(event._id);
                  }
                }}
                disabled={deleting}
                className="rounded-md px-2 py-1 text-xs font-medium text-[color:var(--color-danger)] transition-colors hover:bg-[color:var(--color-danger)]/10 disabled:opacity-50"
              >
                {t('common.delete')}
              </button>
            ) : null}
          </div>
        </td>
      </tr>
      {confirmDialog}
    </>
  );
}
