'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Ban,
  CircleCheck,
  Link2,
  Link2Off,
  MoreHorizontal,
  Trash2,
  UserCog,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { AdminDeleteUserDialog } from '@/components/admin/admin-delete-user-dialog';
import { formatDate } from '@/lib/admin/format';
import {
  adminSuspendUserAction,
  adminUnsuspendUserAction,
  adminChangeUserRoleAction,
  adminSetAffiliateOwnerAction,
} from '@/app/[locale]/(app)/admin/actions';
import { AdminDataTable, type AdminColumn } from './ui/data-table';
import { AdminFilterOption, AdminFilterSelect } from './ui/filter-select';

type User = {
  _id: string;
  phone?: string;
  email?: string;
  fullName?: string;
  role: 'couple' | 'pro' | 'guest' | 'admin';
  /** Suspension administrative — indépendante du rôle depuis sa correction. */
  suspendedAt?: number | null;
  planTier?: string;
  createdAt: number;
  lastSeenAt?: number;
  /**
   * Affilié rattaché à ce compte. Un partenaire peut être aussi bien un couple
   * qu'une agence : c'est pour cela que le rôle ne suffit pas à le repérer.
   */
  affiliate?: {
    id: string;
    code: string;
    kind: 'referral' | 'partner';
    status: 'active' | 'disabled';
  } | null;
};

type PartnerCode = {
  id: string;
  code: string;
  displayName: string | null;
  ownerEmail: string | null;
};

/** Clés de traduction des rôles — le badge affichait la valeur brute en base. */
const ROLE_LABEL_KEY = {
  couple: 'roles.couple',
  pro: 'roles.pro',
  guest: 'roles.guest',
  admin: 'roles.admin',
} as const;

const ROLES = ['couple', 'pro', 'guest', 'admin'] as const;

const ROLE_VARIANT: Record<string, 'neutral' | 'primary' | 'accent' | 'warning' | 'destructive'> = {
  couple: 'primary',
  pro: 'accent',
  guest: 'neutral',
  admin: 'warning',
};

export function AdminUsersTable({
  users,
  partnerCodes = [],
}: {
  users: User[];
  partnerCodes?: PartnerCode[];
}) {
  const t = useTranslations('Admin');
  const locale = useLocale();
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [partnersOnly, setPartnersOnly] = useState(false);

  // Codes partenaire encore libres : proposer un code déjà rattaché ailleurs
  // ne mènerait qu'à un refus serveur (`USER_ALREADY_HAS_AFFILIATE`).
  const takenAffiliateIds = new Set(
    users.map((u) => u.affiliate?.id).filter((id): id is string => Boolean(id)),
  );
  const freeCodes = partnerCodes.filter((c) => !takenAffiliateIds.has(c.id));

  const filtered = users.filter(
    (u) =>
      (roleFilter === 'all' || u.role === roleFilter) &&
      (!partnersOnly || u.affiliate?.kind === 'partner'),
  );

  const columns: AdminColumn<User>[] = [
    {
      id: 'name',
      header: t('users.colName'),
      card: 'title',
      sortValue: (u) => u.fullName ?? '',
      cell: (u) => <span className="font-medium">{u.fullName ?? '—'}</span>,
    },
    {
      id: 'contact',
      header: t('users.colContact'),
      sortValue: (u) => u.email ?? u.phone ?? '',
      cell: (u) => (
        <div className="flex min-w-0 flex-col gap-0.5 text-[color:var(--color-muted-foreground)]">
          {u.email ? <span className="break-all">{u.email}</span> : null}
          {u.phone ? <span className="font-mono text-xs">{u.phone}</span> : null}
          {!u.email && !u.phone ? <span>—</span> : null}
        </div>
      ),
    },
    {
      id: 'role',
      header: t('users.colRole'),
      card: 'badge',
      sortValue: (u) => u.role,
      cell: (u) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={ROLE_VARIANT[u.role] ?? 'neutral'}>{t(ROLE_LABEL_KEY[u.role])}</Badge>
          {/* La suspension se lit à côté du rôle, plus à sa place : le rôle
              reste ce qu'est le compte, la suspension ce qu'on lui a fait. */}
          {u.suspendedAt != null ? (
            <Badge variant="destructive">{t('users.suspended')}</Badge>
          ) : null}
        </div>
      ),
    },
    {
      id: 'plan',
      header: t('users.colPlan'),
      sortValue: (u) => u.planTier ?? '',
      cell: (u) => (
        <span className="text-[color:var(--color-muted-foreground)]">{u.planTier ?? '—'}</span>
      ),
      hideBelow: 'xl',
    },
    {
      id: 'partner',
      header: t('users.colPartner'),
      sortValue: (u) => u.affiliate?.code ?? '',
      cell: (u) => <UserPartnerCell user={u} freeCodes={freeCodes} />,
      hideBelow: 'lg',
    },
    {
      id: 'registeredAt',
      header: t('users.colRegisteredAt'),
      sortValue: (u) => u.createdAt,
      cell: (u) => (
        <span className="whitespace-nowrap text-[color:var(--color-muted-foreground)]">
          {formatDate(u.createdAt, locale)}
        </span>
      ),
    },
    {
      id: 'actions',
      header: t('common.colActions'),
      card: 'actions',
      align: 'right',
      width: 'w-16',
      cell: (u) => <UserActions user={u} />,
    },
  ];

  return (
    <AdminDataTable
      rows={filtered}
      columns={columns}
      getRowId={(u) => u._id}
      searchable={(u) =>
        `${u.fullName ?? ''} ${u.email ?? ''} ${u.phone ?? ''} ${u.affiliate?.code ?? ''}`
      }
      searchPlaceholder={t('users.searchPlaceholder')}
      initialSort={{ id: 'registeredAt', dir: 'desc' }}
      emptyTitle={t('users.emptyTitle')}
      emptyDescription={t('users.emptyDescription')}
      emptyIcon={Users}
      filters={
        <>
          <AdminFilterSelect
            label={t('users.colRole')}
            value={roleFilter}
            onValueChange={setRoleFilter}
          >
            <AdminFilterOption value="all">{t('users.roleFilterAll')}</AdminFilterOption>
            {ROLES.map((role) => (
              <AdminFilterOption key={role} value={role}>
                {t(ROLE_LABEL_KEY[role])}
              </AdminFilterOption>
            ))}
          </AdminFilterSelect>
          <label className="flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-[color:var(--color-border)] px-3 text-sm">
            <Checkbox
              checked={partnersOnly}
              onCheckedChange={(checked) => setPartnersOnly(checked === true)}
              data-testid="filter-partners-only"
            />
            {t('users.partnersOnly')}
          </label>
        </>
      }
    />
  );
}

function UserPartnerCell({ user, freeCodes }: { user: User; freeCodes: PartnerCode[] }) {
  const t = useTranslations('Admin');
  const { execute: setOwner, loading: attaching } = useServerAction(adminSetAffiliateOwnerAction);
  const { confirm, confirmDialog } = useConfirm();

  if (user.affiliate) {
    return (
      <>
        <div className="flex flex-col items-start gap-1">
          <Badge variant={user.affiliate.kind === 'partner' ? 'accent' : 'neutral'}>
            {user.affiliate.code}
          </Badge>
          {/* Seul un partenariat se détache ici : le code de parrainage
              particulier est créé PAR le compte du parrain, le détacher
              laisserait une ligne orpheline. */}
          {user.affiliate.kind === 'partner' ? (
            <button
              type="button"
              onClick={async () => {
                if (await confirm({ title: t('users.confirmDetachPartner') })) {
                  setOwner(user.affiliate!.id, null);
                }
              }}
              disabled={attaching}
              className="focus-ring inline-flex items-center gap-1 rounded text-[0.6875rem] text-[color:var(--color-muted-foreground)] underline underline-offset-2 disabled:opacity-50"
            >
              <Link2Off className="h-3 w-3" strokeWidth={2} aria-hidden />
              {t('users.detachPartner')}
            </button>
          ) : null}
        </div>
        {confirmDialog}
      </>
    );
  }

  if (freeCodes.length === 0) {
    return <span className="text-[color:var(--color-muted-foreground)]">—</span>;
  }

  return (
    <Select value="" disabled={attaching} onValueChange={(id) => setOwner(id, user._id)}>
      <SelectTrigger className="h-8 rounded-md border-[color:var(--color-border)] bg-transparent px-2 text-xs text-[color:var(--color-muted-foreground)]">
        <Link2 className="h-3 w-3 shrink-0" strokeWidth={2} aria-hidden />
        <SelectValue placeholder={t('users.attachPartner')} />
      </SelectTrigger>
      <SelectContent>
        {freeCodes.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.code}
            {c.displayName ? ` — ${c.displayName}` : ''}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Actions d'un compte, repliées dans un menu — suspendre, changer de rôle,
 * supprimer. Les comptes admin n'exposent aucune de ces trois : c'est la garde
 * qui empêche de se retirer soi-même les droits par mégarde.
 */
function UserActions({ user }: { user: User }) {
  const t = useTranslations('Admin');
  const { execute: suspend, loading: suspending } = useServerAction(adminSuspendUserAction);
  const { execute: unsuspend, loading: unsuspending } = useServerAction(adminUnsuspendUserAction);
  const { execute: changeRole, loading: changing } = useServerAction(adminChangeUserRoleAction);
  const { confirm, confirmDialog } = useConfirm();
  const [deleting, setDeleting] = useState(false);
  const suspended = user.suspendedAt != null;
  const label = user.fullName ?? user.email ?? user.phone ?? user._id;

  if (user.role === 'admin') {
    return <span className="text-xs text-[color:var(--color-muted-foreground)]">—</span>;
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={suspending || unsuspending || changing}
            aria-label={t('common.colActions')}
            className="focus-ring inline-flex h-8 w-8 items-center justify-center rounded-md text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-surface-elevated)] hover:text-[color:var(--color-foreground)] disabled:opacity-50"
          >
            <MoreHorizontal className="h-4 w-4" strokeWidth={2} aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>{t('users.rolePlaceholder')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={user.role}
            onValueChange={async (value) => {
              const newRole = value as User['role'];
              if (newRole === user.role) return;
              if (
                await confirm({
                  // Libellé traduit, pas la valeur en base : « Couple », pas « couple ».
                  title: t('users.confirmChangeRole', { role: t(ROLE_LABEL_KEY[newRole]) }),
                })
              ) {
                changeRole(user._id, newRole);
              }
            }}
          >
            {ROLES.map((role) => (
              <DropdownMenuRadioItem key={role} value={role}>
                <UserCog strokeWidth={1.75} aria-hidden />
                {t(ROLE_LABEL_KEY[role])}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>

          <DropdownMenuSeparator />

          {suspended ? (
            <DropdownMenuItem
              onSelect={async () => {
                if (await confirm({ title: t('users.confirmUnsuspend', { name: label }) })) {
                  unsuspend(user._id);
                }
              }}
            >
              <CircleCheck strokeWidth={1.75} aria-hidden />
              {t('users.unsuspend')}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              variant="destructive"
              onSelect={async () => {
                if (
                  await confirm({
                    title: t('users.confirmSuspend', { name: label }),
                    destructive: true,
                  })
                ) {
                  suspend(user._id);
                }
              }}
            >
              <Ban strokeWidth={1.75} aria-hidden />
              {t('users.suspend')}
            </DropdownMenuItem>
          )}

          {/* Suspendre neutralise, supprimer efface. Un compte ouvert pour
              tester n'a aucune raison de rester : c'est la seule sortie. */}
          <DropdownMenuItem
            variant="destructive"
            data-testid="admin-delete-user"
            onSelect={() => setDeleting(true)}
          >
            <Trash2 strokeWidth={1.75} aria-hidden />
            {t('common.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {confirmDialog}
      <AdminDeleteUserDialog
        userId={user._id}
        displayName={label}
        open={deleting}
        onOpenChange={setDeleting}
      />
    </>
  );
}
