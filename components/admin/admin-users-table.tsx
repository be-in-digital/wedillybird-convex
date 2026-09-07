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
import { matchesRoleFilter, type RoleFilterValue } from '@/lib/admin/user-filters';
import {
  adminSuspendUserAction,
  adminUnsuspendUserAction,
  adminChangeUserRoleAction,
  adminSetAffiliateOwnerAction,
} from '@/app/[locale]/(app)/admin/actions';

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
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [partnersOnly, setPartnersOnly] = useState(false);

  // Codes partenaire encore libres : proposer un code déjà rattaché ailleurs
  // ne mènerait qu'à un refus serveur (`USER_ALREADY_HAS_AFFILIATE`).
  const takenAffiliateIds = new Set(
    users.map((u) => u.affiliate?.id).filter((id): id is string => Boolean(id)),
  );
  const freeCodes = partnerCodes.filter((c) => !takenAffiliateIds.has(c.id));

  const filtered = users.filter((u) => {
    const matchSearch =
      !search ||
      u.fullName?.toLowerCase().includes(search.toLowerCase()) ||
      u.email?.toLowerCase().includes(search.toLowerCase()) ||
      u.phone?.includes(search) ||
      u.affiliate?.code.toLowerCase().includes(search.toLowerCase());
    const matchRole = matchesRoleFilter(u.role, roleFilter as RoleFilterValue);
    const matchPartner = !partnersOnly || u.affiliate?.kind === 'partner';
    return matchSearch && matchRole && matchPartner;
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder={t('users.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-10 w-full rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-sm text-[color:var(--color-foreground)] placeholder:text-[color:var(--color-muted-foreground)] focus:ring-1 focus:ring-[color:var(--color-border-strong)] focus:outline-none sm:w-72"
        />
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-full rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-sm text-[color:var(--color-foreground)] sm:w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('users.roleFilterAll')}</SelectItem>
            <SelectItem value="couple">{t('roles.couple')}</SelectItem>
            <SelectItem value="pro">{t('roles.pro')}</SelectItem>
            <SelectItem value="guest">{t('roles.guest')}</SelectItem>
            <SelectItem value="admin">{t('roles.admin')}</SelectItem>
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm text-[color:var(--color-foreground)]">
          <input
            type="checkbox"
            checked={partnersOnly}
            onChange={(e) => setPartnersOnly(e.target.checked)}
            className="h-4 w-4"
            data-testid="filter-partners-only"
          />
          {t('users.partnersOnly')}
        </label>
        <span className="font-mono text-xs text-[color:var(--color-muted-foreground)]">
          {t('users.count', { count: filtered.length })}
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[color:var(--color-border)]">
        <table className="w-full min-w-[700px] text-sm">
          <thead>
            <tr className="border-b border-[color:var(--color-border)] bg-[color:var(--color-surface)]">
              <Th>{t('users.colName')}</Th>
              <Th>{t('users.colContact')}</Th>
              <Th>{t('users.colRole')}</Th>
              <Th>{t('users.colPlan')}</Th>
              <Th>{t('users.colPartner')}</Th>
              <Th>{t('users.colRegisteredAt')}</Th>
              <Th>{t('common.colActions')}</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => (
              <UserRow key={u._id} user={u} freeCodes={freeCodes} />
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

function UserRow({ user, freeCodes }: { user: User; freeCodes: PartnerCode[] }) {
  const t = useTranslations('Admin');
  const locale = useLocale();
  const { execute: suspend, loading: suspending } = useServerAction(adminSuspendUserAction);
  const { execute: unsuspend, loading: unsuspending } = useServerAction(adminUnsuspendUserAction);
  const { execute: changeRole, loading: changing } = useServerAction(adminChangeUserRoleAction);
  const { execute: setOwner, loading: attaching } = useServerAction(adminSetAffiliateOwnerAction);
  const { confirm, confirmDialog } = useConfirm();
  const suspended = user.suspendedAt != null;

  return (
    <>
      <tr className="border-b border-[color:var(--color-border)] last:border-0 hover:bg-[color:var(--color-surface-elevated)]/50">
        <td className="px-4 py-3 font-medium">{user.fullName ?? '—'}</td>
        <td className="px-4 py-3 text-[color:var(--color-muted-foreground)]">
          <div className="flex min-w-0 flex-col gap-0.5">
            {user.email ? <span className="break-all">{user.email}</span> : null}
            {user.phone ? <span className="font-mono text-xs">{user.phone}</span> : null}
          </div>
        </td>
        <td className="px-4 py-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={ROLE_VARIANT[user.role] ?? 'neutral'}>
              {t(ROLE_LABEL_KEY[user.role])}
            </Badge>
            {/* La suspension se lit à côté du rôle, plus à sa place : le rôle
                reste ce qu'est le compte, la suspension ce qu'on lui a fait. */}
            {suspended ? <Badge variant="destructive">{t('users.suspended')}</Badge> : null}
          </div>
        </td>
        <td className="px-4 py-3 text-[color:var(--color-muted-foreground)]">
          {user.planTier ?? '—'}
        </td>
        <td className="px-4 py-3">
          {user.affiliate ? (
            <div className="flex flex-col items-start gap-1">
              <Badge variant={user.affiliate.kind === 'partner' ? 'accent' : 'neutral'}>
                {user.affiliate.code}
              </Badge>
              {/* Seul un partenariat se détache ici : le code de parrainage
                  particulier est créé PAR le compte du parrain, le détacher
                  laisserait une ligne orpheline. */}
              {user.affiliate.kind === 'partner' ? (
                <button
                  onClick={async () => {
                    if (await confirm({ title: t('users.confirmDetachPartner') })) {
                      setOwner(user.affiliate!.id, null);
                    }
                  }}
                  disabled={attaching}
                  className="text-[11px] text-[color:var(--color-muted-foreground)] underline underline-offset-2 disabled:opacity-50"
                >
                  {t('users.detachPartner')}
                </button>
              ) : null}
            </div>
          ) : freeCodes.length > 0 ? (
            <Select
              value=""
              disabled={attaching}
              onValueChange={(affiliateId) => setOwner(affiliateId, user._id)}
            >
              <SelectTrigger className="rounded-md border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-xs text-[color:var(--color-muted-foreground)]">
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
          ) : (
            <span className="text-[color:var(--color-muted-foreground)]">—</span>
          )}
        </td>
        <td className="px-4 py-3 text-[color:var(--color-muted-foreground)]">
          {new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
            new Date(user.createdAt),
          )}
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            {user.role === 'admin' ? null : suspended ? (
              <button
                onClick={async () => {
                  if (
                    await confirm({
                      title: t('users.confirmUnsuspend', {
                        name: user.fullName ?? user.email ?? user._id,
                      }),
                    })
                  ) {
                    unsuspend(user._id);
                  }
                }}
                disabled={unsuspending}
                className="rounded-md px-2 py-1 text-xs font-medium text-[color:var(--color-accent)] transition-colors hover:bg-[color:var(--color-accent)]/10 disabled:opacity-50"
              >
                {t('users.unsuspend')}
              </button>
            ) : (
              <button
                onClick={async () => {
                  if (
                    await confirm({
                      title: t('users.confirmSuspend', {
                        name: user.fullName ?? user.email ?? user._id,
                      }),
                      destructive: true,
                    })
                  ) {
                    suspend(user._id);
                  }
                }}
                disabled={suspending}
                className="rounded-md px-2 py-1 text-xs font-medium text-[color:var(--color-danger)] transition-colors hover:bg-[color:var(--color-danger)]/10 disabled:opacity-50"
              >
                {t('users.suspend')}
              </button>
            )}
            {user.role !== 'admin' ? (
              <Select
                value=""
                disabled={changing}
                onValueChange={async (v) => {
                  const newRole = v as User['role'];
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
                <SelectTrigger className="rounded-md border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-xs text-[color:var(--color-muted-foreground)]">
                  <SelectValue placeholder={t('users.rolePlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="couple">{t('roles.couple')}</SelectItem>
                  <SelectItem value="pro">{t('roles.pro')}</SelectItem>
                  <SelectItem value="guest">{t('roles.guest')}</SelectItem>
                  <SelectItem value="admin">{t('roles.admin')}</SelectItem>
                </SelectContent>
              </Select>
            ) : null}
          </div>
        </td>
      </tr>
      {confirmDialog}
    </>
  );
}
