'use client';

import { useState } from 'react';
import { BookOpen } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useServerAction } from '@/components/admin/use-admin-action';
import { formatDate } from '@/lib/admin/format';
import { adminUpdatePhotoBookStatusAction } from '@/app/[locale]/(app)/admin/actions';
import {
  AdminCardList,
  AdminFilterOption,
  AdminFilterSelect,
  StatusPill,
  type StatusTone,
} from './ui';

type Status = 'requested' | 'in_production' | 'shipped' | 'cancelled';

interface Order {
  _id: string;
  eventId: string;
  eventTitle: string | null;
  status: Status;
  recipientName: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  postalCode: string;
  country: string;
  notes?: string;
  ownerName: string | null;
  ownerEmail: string | null;
  createdAt: number;
  updatedAt: number;
}

const STATUS_LABEL: Record<Status, string> = {
  requested: 'Commande reçue',
  in_production: 'En fabrication',
  shipped: 'Expédié',
  cancelled: 'Annulé',
};

const STATUS_TONE: Record<Status, StatusTone> = {
  requested: 'warning',
  in_production: 'progress',
  shipped: 'success',
  cancelled: 'neutral',
};

const STATUS_ORDER: Status[] = ['requested', 'in_production', 'shipped', 'cancelled'];

function addressOf(order: Order): string {
  return [
    order.addressLine1,
    order.addressLine2,
    `${order.postalCode} ${order.city}`,
    order.country,
  ]
    .filter(Boolean)
    .join(', ');
}

/**
 * Commandes de livre photo. Rendues en cartes plutôt qu'en tableau : une adresse
 * postale complète tronquée dans une colonne est inutilisable, or c'est la seule
 * information dont l'admin a besoin ici pour expédier.
 */
export function AdminPhotoBooksTable({ orders }: { orders: Order[] }) {
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const filtered = orders.filter((o) => statusFilter === 'all' || o.status === statusFilter);

  return (
    <AdminCardList
      rows={filtered}
      getRowId={(o) => o._id}
      searchable={(o) =>
        `${o.eventTitle ?? ''} ${o.recipientName} ${addressOf(o)} ${o.ownerName ?? ''} ${o.ownerEmail ?? ''}`
      }
      searchPlaceholder="Rechercher un destinataire, une ville…"
      emptyTitle="Aucune commande de livre photo"
      emptyDescription="Les commandes passées depuis l'upsell HD apparaîtront ici, prêtes à expédier."
      emptyIcon={BookOpen}
      filters={
        <AdminFilterSelect label="Statut" value={statusFilter} onValueChange={setStatusFilter}>
          <AdminFilterOption value="all">Tous</AdminFilterOption>
          {STATUS_ORDER.map((s) => (
            <AdminFilterOption key={s} value={s}>
              {STATUS_LABEL[s]}
            </AdminFilterOption>
          ))}
        </AdminFilterSelect>
      }
      renderCard={(order) => <PhotoBookCard order={order} />}
    />
  );
}

function PhotoBookCard({ order }: { order: Order }) {
  const { execute, loading, error } = useServerAction(adminUpdatePhotoBookStatusAction);

  return (
    <div
      className="flex flex-col gap-4 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-4 sm:flex-row sm:items-start sm:justify-between"
      data-testid="photo-book-order-row"
    >
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-[color:var(--color-foreground)]">
            {order.eventTitle ?? '—'}
          </span>
          <StatusPill tone={STATUS_TONE[order.status]}>{STATUS_LABEL[order.status]}</StatusPill>
          <span className="font-mono text-xs text-[color:var(--color-muted-foreground)]">
            {formatDate(order.createdAt)}
          </span>
        </div>

        <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
          <Field label="Destinataire">{order.recipientName}</Field>
          <Field label="Compte">
            {order.ownerName ?? '—'}
            {order.ownerEmail ? (
              <span className="text-[color:var(--color-muted-foreground)]">
                {' '}
                · {order.ownerEmail}
              </span>
            ) : null}
          </Field>
          <Field label="Adresse" className="sm:col-span-2">
            {addressOf(order)}
          </Field>
        </dl>

        {order.notes ? (
          <p className="text-xs text-[color:var(--color-muted-foreground)] italic">
            « {order.notes} »
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-xs text-[color:var(--color-destructive)]">
            {error}
          </p>
        ) : null}
      </div>

      <Select
        value={order.status}
        onValueChange={(v) => execute(order._id, v as Status)}
        disabled={loading}
      >
        <SelectTrigger
          aria-label="Statut de la commande"
          className="h-10 w-full shrink-0 rounded-lg text-sm sm:w-[11rem]"
          data-testid="photo-book-status-select"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATUS_ORDER.map((s) => (
            <SelectItem key={s} value={s}>
              {STATUS_LABEL[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-[0.625rem] font-semibold tracking-[0.08em] text-[color:var(--color-muted-foreground)] uppercase">
        {label}
      </dt>
      <dd className="mt-0.5 break-words">{children}</dd>
    </div>
  );
}
