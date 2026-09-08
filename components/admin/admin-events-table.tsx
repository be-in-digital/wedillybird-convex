'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CalendarDays, Gift, MoreHorizontal, Trash2, Undo2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useServerAction } from '@/components/admin/use-admin-action';
import { formatDate } from '@/lib/admin/format';
import {
  adminUpdateEventStatusAction,
  adminDeleteEventAction,
  adminGrantEventPlanAction,
  adminRevokeEventPlanAction,
} from '@/app/[locale]/(app)/admin/actions';
import {
  AdminDataTable,
  AdminFilterOption,
  AdminFilterSelect,
  StatusPill,
  type AdminColumn,
  type StatusTone,
} from './ui';

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

const STATUS_TONE: Record<Event['status'], StatusTone> = {
  draft: 'neutral',
  active: 'success',
  archived: 'warning',
  cancelled: 'danger',
};

const STATUSES = ['draft', 'active', 'archived', 'cancelled'] as const;

export function AdminEventsTable({ events }: { events: Event[] }) {
  const t = useTranslations('Admin');
  const locale = useLocale();
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const filtered = events.filter((e) => statusFilter === 'all' || e.status === statusFilter);

  const columns: AdminColumn<Event>[] = [
    {
      id: 'couple',
      header: t('events.colCouple'),
      card: 'title',
      sortValue: (e) => `${e.coupleNames.partnerA} ${e.coupleNames.partnerB}`,
      cell: (e) => (
        <div className="min-w-0">
          <p className="truncate font-medium">
            {e.coupleNames.partnerA} &amp; {e.coupleNames.partnerB}
          </p>
          <p className="truncate text-xs text-[color:var(--color-muted-foreground)]">{e.title}</p>
        </div>
      ),
    },
    {
      id: 'date',
      header: t('events.colDate'),
      sortValue: (e) => e.eventDate,
      cell: (e) => (
        <span className="whitespace-nowrap text-[color:var(--color-muted-foreground)]">
          {formatDate(e.eventDate, locale)}
        </span>
      ),
    },
    {
      id: 'status',
      header: t('events.colStatus'),
      card: 'badge',
      sortValue: (e) => e.status,
      cell: (e) => (
        <StatusPill tone={STATUS_TONE[e.status] ?? 'neutral'}>
          {t(`eventStatuses.${e.status}`)}
        </StatusPill>
      ),
    },
    {
      id: 'plan',
      header: t('events.colPlan'),
      sortValue: (e) => e.planTier ?? '',
      cell: (e) => (
        <span className="flex flex-wrap items-center gap-1.5 text-[color:var(--color-muted-foreground)]">
          {e.planTier ?? '—'}
          {e.comped ? <Badge variant="warning">{t('events.compedBadge')}</Badge> : null}
        </span>
      ),
    },
    {
      id: 'owner',
      header: t('events.colOwner'),
      sortValue: (e) => e.ownerName ?? e.ownerEmail ?? '',
      cell: (e) => (
        <span className="truncate text-[color:var(--color-muted-foreground)]">
          {e.ownerName ?? e.ownerEmail ?? '—'}
        </span>
      ),
      hideBelow: 'lg',
    },
    {
      id: 'actions',
      header: t('common.colActions'),
      card: 'actions',
      align: 'right',
      width: 'w-16',
      cell: (e) => <EventActions event={e} />,
    },
  ];

  return (
    <AdminDataTable
      rows={filtered}
      columns={columns}
      getRowId={(e) => e._id}
      searchable={(e) =>
        `${e.title} ${e.coupleNames.partnerA} ${e.coupleNames.partnerB} ${e.ownerName ?? ''} ${e.ownerEmail ?? ''}`
      }
      searchPlaceholder={t('events.searchPlaceholder')}
      initialSort={{ id: 'date', dir: 'desc' }}
      emptyTitle={t('events.emptyTitle')}
      emptyDescription={t('events.emptyDescription')}
      emptyIcon={CalendarDays}
      filters={
        <AdminFilterSelect
          label={t('events.colStatus')}
          value={statusFilter}
          onValueChange={setStatusFilter}
        >
          <AdminFilterOption value="all">{t('events.statusFilterAll')}</AdminFilterOption>
          {STATUSES.map((s) => (
            <AdminFilterOption key={s} value={s}>
              {t(`eventStatuses.${s}`)}
            </AdminFilterOption>
          ))}
        </AdminFilterSelect>
      }
    />
  );
}

/**
 * Actions d'une ligne, repliées dans un menu.
 *
 * La version précédente alignait un select de statut, deux boutons d'offre et un
 * bouton de suppression **dans la cellule** : cinq cibles côte à côte, illisibles
 * dès que la fenêtre rétrécissait, et impossibles à atteindre sur téléphone. Un
 * seul déclencheur, un menu qui nomme chaque geste.
 */
function EventActions({ event }: { event: Event }) {
  const t = useTranslations('Admin');
  // Le libellé du forfait, traduit : la confirmation disait « le forfait
  // « premium » », c'est-à-dire la valeur en base, pas un mot français.
  const tPlans = useTranslations('Plans.tiers');
  const { execute: updateStatus, loading: updating } = useServerAction(
    adminUpdateEventStatusAction,
  );
  const { execute: deleteEvent, loading: deleting } = useServerAction(adminDeleteEventAction);
  const { execute: grantPlan, loading: granting } = useServerAction(adminGrantEventPlanAction);
  const { execute: revokePlan, loading: revoking } = useServerAction(adminRevokeEventPlanAction);
  const { confirm, confirmDialog } = useConfirm();
  const busy = updating || deleting || granting || revoking;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={busy}
            aria-label={t('common.colActions')}
            className="focus-ring inline-flex h-8 w-8 items-center justify-center rounded-md text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-surface-elevated)] hover:text-[color:var(--color-foreground)] disabled:opacity-50"
          >
            <MoreHorizontal className="h-4 w-4" strokeWidth={2} aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>{t('events.statusPlaceholder')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={event.status}
            onValueChange={async (value) => {
              const newStatus = value as Event['status'];
              if (newStatus === event.status) return;
              if (
                await confirm({
                  // Libellé traduit, pas la valeur en base : « Actif », pas « active ».
                  title: t('events.confirmChangeStatus', {
                    status: t(`eventStatuses.${newStatus}`),
                  }),
                })
              ) {
                updateStatus(event._id, newStatus);
              }
            }}
          >
            {STATUSES.map((s) => (
              <DropdownMenuRadioItem key={s} value={s}>
                {t(`eventStatuses.${s}`)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>

          <DropdownMenuSeparator />

          {/* Forfait offert : la seule façon de donner un accès Premium sans
              transaction Stripe (partenariat, démo). La révocation n'est
              proposée que sur un forfait effectivement offert — le serveur
              refuse de toute façon sur un event payé. */}
          {event.comped ? (
            <DropdownMenuItem
              onSelect={async () => {
                if (await confirm({ title: t('events.confirmRevokePlan'), destructive: true })) {
                  revokePlan(event._id, undefined);
                }
              }}
            >
              <Undo2 strokeWidth={1.75} aria-hidden />
              {t('events.revokePlan')}
            </DropdownMenuItem>
          ) : (
            <>
              {/* Premium est le geste par défaut : un menu où il faut encore
                  choisir n'a pas de défaut. L'entrée principale n'envoie donc
                  AUCUN tier — c'est `DEFAULT_COMPED_EVENT_PLAN` qui tranche côté
                  serveur. L'Essentiel reste offrable, en le demandant. */}
              <DropdownMenuItem
                onSelect={async () => {
                  if (
                    await confirm({
                      title: t('events.confirmGrantPlan', { plan: tPlans('premium') }),
                    })
                  ) {
                    grantPlan(event._id, undefined, undefined);
                  }
                }}
              >
                <Gift strokeWidth={1.75} aria-hidden />
                {t('events.grantPremium')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={async () => {
                  if (
                    await confirm({
                      title: t('events.confirmGrantPlan', { plan: tPlans('essential') }),
                    })
                  ) {
                    grantPlan(event._id, 'essential', undefined);
                  }
                }}
              >
                <Gift strokeWidth={1.75} aria-hidden />
                {t('events.grantEssential')}
              </DropdownMenuItem>
            </>
          )}

          {event.status !== 'cancelled' ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={async () => {
                  if (
                    await confirm({
                      title: t('events.confirmDelete', { title: event.title }),
                      destructive: true,
                    })
                  ) {
                    deleteEvent(event._id);
                  }
                }}
              >
                <Trash2 strokeWidth={1.75} aria-hidden />
                {t('common.delete')}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {confirmDialog}
    </>
  );
}
