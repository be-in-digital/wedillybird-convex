'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { ThemeProvider } from '@/components/ui/theme-provider';
import {
  LayoutDashboard,
  Users,
  Heart,
  ListChecks,
  Wallet,
  Store,
  UsersRound,
  BarChart3,
  CreditCard,
  Settings,
  Plug,
  FileText,
  Banknote,
  FileSignature,
  Menu,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  LogOut,
  Lock,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { PartnerSpaceLink } from '@/components/partner/partner-space-link';
import { signOutAction } from '@/app/[locale]/(auth)/actions';
import { LocaleSwitcher } from '@/components/layout/locale-switcher';
import { StoreNotificationBell } from '@/components/notifications/store-notification-bell';
import { cn } from '@/lib/cn';
import { PRO_TIER_LIMITS, tierHasFeature, type ProFeature } from '@/lib/payments/entitlements';
import type { SubscriptionTier } from '@/lib/payments/subscriptions';

/**
 * ProSidebarShell — chrome **dark « Linear-grade »** du back-office agence.
 *
 * Sidebar repliable (desktop) + tiroir (mobile), top bar avec recherche, jauge
 * d'events, notifications, langue et déconnexion. Reprend la structure du design
 * (groupes Général / Organisation / Pilotage) et matérialise le **gating par
 * forfait** : les modules non inclus dans le tier de l'agence portent un cadenas
 * et mènent à une page d'upsell.
 *
 * Client component (état repli/tiroir) ; chaque page pro reste un server
 * component qui fetch ses données puis passe le contenu en `children`.
 */

export type ProNavKey =
  | 'dashboard'
  | 'clients'
  | 'weddings'
  | 'planning'
  | 'budget'
  | 'vendors'
  | 'team'
  | 'quotes'
  | 'payments'
  | 'contracts'
  | 'analytics'
  | 'integrations'
  | 'billing'
  | 'settings';

interface NavItem {
  key: ProNavKey;
  labelKey: string;
  href:
    | '/pro/dashboard'
    | '/pro/clients'
    | '/pro/weddings'
    | '/pro/planning'
    | '/pro/budget'
    | '/pro/vendors'
    | '/pro/team'
    | '/pro/quotes'
    | '/pro/payments'
    | '/pro/contracts'
    | '/pro/analytics'
    | '/pro/integrations'
    | '/pro/billing'
    | '/pro/settings';
  Icon: LucideIcon;
  /** Fonctionnalité requise — si le tier ne l'a pas, l'item est verrouillé. */
  feature?: ProFeature;
}

const NAV_GROUPS: ReadonlyArray<{ labelKey: string; items: ReadonlyArray<NavItem> }> = [
  {
    labelKey: 'sidebar.groupGeneral',
    items: [
      {
        key: 'dashboard',
        labelKey: 'sidebar.navDashboard',
        href: '/pro/dashboard',
        Icon: LayoutDashboard,
      },
      {
        key: 'clients',
        labelKey: 'sidebar.navClients',
        href: '/pro/clients',
        Icon: Users,
        feature: 'crmPipeline',
      },
      { key: 'weddings', labelKey: 'sidebar.navWeddings', href: '/pro/weddings', Icon: Heart },
    ],
  },
  {
    labelKey: 'sidebar.groupOrganization',
    items: [
      { key: 'planning', labelKey: 'sidebar.navPlanning', href: '/pro/planning', Icon: ListChecks },
      { key: 'budget', labelKey: 'sidebar.navBudget', href: '/pro/budget', Icon: Wallet },
      { key: 'vendors', labelKey: 'sidebar.navVendors', href: '/pro/vendors', Icon: Store },
      { key: 'team', labelKey: 'sidebar.navTeam', href: '/pro/team', Icon: UsersRound },
    ],
  },
  {
    labelKey: 'sidebar.groupFinances',
    items: [
      {
        key: 'quotes',
        labelKey: 'sidebar.navQuotes',
        href: '/pro/quotes',
        Icon: FileText,
        feature: 'documentsEsign',
      },
      {
        key: 'payments',
        labelKey: 'sidebar.navPayments',
        href: '/pro/payments',
        Icon: Banknote,
        feature: 'documentsEsign',
      },
      {
        key: 'contracts',
        labelKey: 'sidebar.navContracts',
        href: '/pro/contracts',
        Icon: FileSignature,
        feature: 'documentsEsign',
      },
    ],
  },
  {
    labelKey: 'sidebar.groupPilotage',
    items: [
      {
        key: 'analytics',
        labelKey: 'sidebar.navAnalytics',
        href: '/pro/analytics',
        Icon: BarChart3,
        feature: 'analyticsMulti',
      },
      {
        key: 'integrations',
        labelKey: 'sidebar.navIntegrations',
        href: '/pro/integrations',
        Icon: Plug,
        feature: 'crmPipeline',
      },
      { key: 'billing', labelKey: 'sidebar.navBilling', href: '/pro/billing', Icon: CreditCard },
      { key: 'settings', labelKey: 'sidebar.navSettings', href: '/pro/settings', Icon: Settings },
    ],
  },
];

const ROLE_LABEL_KEY: Record<'owner' | 'admin' | 'planner' | 'viewer', string> = {
  owner: 'sidebar.roleOwner',
  admin: 'sidebar.roleAdmin',
  planner: 'sidebar.rolePlanner',
  viewer: 'sidebar.roleViewer',
};

const TIER_LABEL: Record<SubscriptionTier, string> = {
  starter: 'Starter',
  business: 'Business',
  agency: 'Agency',
};

export interface ProSidebarShellProps {
  current: ProNavKey;
  org: {
    name: string;
    primaryColor?: string | null;
    tier?: SubscriptionTier | null;
    role: 'owner' | 'admin' | 'planner' | 'viewer';
  };
  user: { name?: string | null };
  /** Jauge d'events affichée dans la top bar (réelle). */
  eventsUsed?: number;
  children: ReactNode;
}

function initialsOf(name?: string | null): string {
  if (!name) return '·';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p.charAt(0).toUpperCase()).join('') || '·';
}

export function ProSidebarShell({
  current,
  org,
  user,
  eventsUsed,
  children,
}: ProSidebarShellProps) {
  const t = useTranslations('Pro.main');
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Échap ferme le tiroir mobile.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  const tier = org.tier ?? null;
  const dot = org.primaryColor || 'var(--color-gold-500)';
  const eventsCap = tier ? PRO_TIER_LIMITS[tier].activeEvents : null;
  const roleLabel = t(ROLE_LABEL_KEY[org.role] as Parameters<typeof t>[0]);

  return (
    <ThemeProvider theme="dark">
      <div
        data-theme="dark"
        className={cn(
          'grid min-h-screen bg-[color:var(--color-background)] text-[color:var(--color-foreground)]',
          collapsed ? 'lg:grid-cols-[76px_1fr]' : 'lg:grid-cols-[256px_1fr]',
        )}
      >
        {/* Backdrop mobile */}
        <div
          aria-hidden
          onClick={() => setMobileOpen(false)}
          className={cn(
            'fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity lg:hidden',
            mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}
        />

        {/* Sidebar — collée au viewport (sticky, hauteur d'écran) pour que le pied
          (utilisateur + déconnexion) reste toujours en bas de l'écran, même si le
          contenu de la page dépasse la hauteur du viewport. */}
        <aside
          className={cn(
            'fixed inset-y-0 left-0 z-50 flex h-dvh w-[256px] flex-col border-r border-[color:var(--color-border)] bg-[color:var(--color-surface)] transition-transform duration-300 lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:translate-x-0 lg:self-start',
            collapsed ? 'lg:w-[76px]' : 'lg:w-[256px]',
            mobileOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          {/* Brand — hauteur alignée sur la top bar (même filet horizontal). */}
          <div className="flex h-16 flex-shrink-0 items-center justify-between gap-2 border-b border-[color:var(--color-border)] px-4">
            <Link
              href="/pro/dashboard"
              className="focus-ring flex min-w-0 items-center gap-2.5 rounded-lg"
              title={org.name}
            >
              <span
                aria-hidden
                className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full"
                style={{ background: dot }}
              />
              {!collapsed ? (
                <span className="flex min-w-0 flex-col">
                  <span className="font-display truncate text-lg leading-tight italic">
                    {org.name}
                  </span>
                  <span className="font-mono text-[9px] tracking-[0.18em] text-[color:var(--color-muted-foreground)] uppercase">
                    {tier
                      ? t('sidebar.planLabel', { tier: TIER_LABEL[tier] })
                      : t('sidebar.noPlan')}
                  </span>
                </span>
              ) : null}
            </Link>
            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              aria-pressed={collapsed}
              aria-label={collapsed ? t('sidebar.expandMenu') : t('sidebar.collapseMenu')}
              className="focus-ring hidden flex-shrink-0 rounded-lg p-1.5 text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-surface-elevated)] hover:text-[color:var(--color-foreground)] lg:inline-flex"
            >
              {collapsed ? (
                <PanelLeftOpen className="h-4 w-4" strokeWidth={1.85} />
              ) : (
                <PanelLeftClose className="h-4 w-4" strokeWidth={1.85} />
              )}
            </button>
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label={t('sidebar.closeMenu')}
              className="focus-ring flex-shrink-0 rounded-lg p-1.5 text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-surface-elevated)] lg:hidden"
            >
              <X className="h-4 w-4" strokeWidth={1.85} />
            </button>
          </div>

          {/* Nav */}
          <nav
            aria-label={t('sidebar.mainNavAria')}
            className="flex-1 overflow-y-auto px-3 py-4"
            onClick={() => setMobileOpen(false)}
          >
            {NAV_GROUPS.map((group) => {
              const groupLabel = t(group.labelKey as Parameters<typeof t>[0]);
              return (
                <div key={group.labelKey} className="mb-5 flex flex-col gap-0.5">
                  {!collapsed ? (
                    <p className="mb-1.5 px-2 font-mono text-[9px] tracking-[0.22em] text-[color:var(--color-muted-foreground)] uppercase">
                      {groupLabel}
                    </p>
                  ) : (
                    <span aria-hidden className="mx-2 mb-1.5 h-px bg-[color:var(--color-border)]" />
                  )}
                  {group.items.map((item) => {
                    const active = item.key === current;
                    const locked = item.feature ? !tierHasFeature(tier, item.feature) : false;
                    const itemLabel = t(item.labelKey as Parameters<typeof t>[0]);
                    return (
                      <Link
                        key={item.key}
                        href={item.href}
                        aria-current={active ? 'page' : undefined}
                        title={itemLabel}
                        className={cn(
                          'focus-ring group flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors',
                          collapsed && 'justify-center',
                          active
                            ? 'bg-[color:var(--color-surface-elevated)] font-medium text-[color:var(--color-foreground)]'
                            : 'text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-surface-elevated)] hover:text-[color:var(--color-foreground)]',
                        )}
                      >
                        <span
                          aria-hidden
                          className={cn(
                            'flex-shrink-0',
                            active ? 'text-[color:var(--color-blush-300)]' : '',
                          )}
                        >
                          <item.Icon className="h-[18px] w-[18px]" strokeWidth={1.85} />
                        </span>
                        {!collapsed ? (
                          <>
                            <span className="flex-1 truncate">{itemLabel}</span>
                            {locked ? (
                              <Lock
                                className="h-3.5 w-3.5 flex-shrink-0 text-[color:var(--color-muted-foreground)]"
                                strokeWidth={1.85}
                                aria-label={t('sidebar.lockedFeatureAria')}
                              />
                            ) : null}
                          </>
                        ) : null}
                      </Link>
                    );
                  })}
                </div>
              );
            })}
            {/* Espace partenaire — hors NAV_GROUPS parce qu'il ne concerne que
                les agences réellement partenaires : le composant s'efface pour
                tous les autres. Sans cette entrée, la page était orpheline. */}
            <PartnerSpaceLink variant="sidebar" className={cn(collapsed && 'justify-center')} />
          </nav>

          {/* Footer : utilisateur connecté + déconnexion (icône seule, à droite) */}
          <div className="border-t border-[color:var(--color-border)] p-3">
            <div
              className={cn('flex items-center gap-2.5 px-0.5 py-1', collapsed && 'justify-center')}
            >
              <span
                aria-hidden
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[color:var(--color-surface-elevated)] font-mono text-[11px] text-[color:var(--color-blush-300)]"
              >
                {initialsOf(user.name)}
              </span>
              {!collapsed ? (
                <>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium text-[color:var(--color-foreground)]">
                      {user.name ?? '—'}
                    </span>
                    <span className="font-mono text-[9px] tracking-[0.18em] text-[color:var(--color-muted-foreground)] uppercase">
                      {roleLabel}
                    </span>
                  </span>
                  <form action={signOutAction} className="flex-shrink-0">
                    <button
                      type="submit"
                      aria-label={t('sidebar.signOut')}
                      title={t('sidebar.signOut')}
                      className="focus-ring grid h-8 w-8 place-items-center rounded-lg text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-surface-elevated)] hover:text-[color:var(--color-foreground)]"
                    >
                      <LogOut className="h-4 w-4" strokeWidth={1.85} aria-hidden />
                    </button>
                  </form>
                </>
              ) : null}
            </div>
            {collapsed ? (
              <form action={signOutAction} className="mt-1 flex justify-center">
                <button
                  type="submit"
                  aria-label={t('sidebar.signOut')}
                  title={t('sidebar.signOut')}
                  className="focus-ring grid h-8 w-8 place-items-center rounded-lg text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-surface-elevated)] hover:text-[color:var(--color-foreground)]"
                >
                  <LogOut className="h-4 w-4" strokeWidth={1.85} aria-hidden />
                </button>
              </form>
            ) : null}
          </div>
        </aside>

        {/* Body */}
        <div className="flex min-w-0 flex-col">
          {/* Top bar */}
          <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-[color:var(--color-border)] bg-[color:var(--color-background)]/85 px-4 backdrop-blur supports-[backdrop-filter]:bg-[color:var(--color-background)]/65 sm:px-6">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label={t('sidebar.openMenu')}
              className="focus-ring rounded-lg p-1.5 text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-surface-elevated)] lg:hidden"
            >
              <Menu className="h-5 w-5" strokeWidth={1.85} />
            </button>

            <label className="relative hidden max-w-sm flex-1 items-center sm:flex">
              <Search
                className="pointer-events-none absolute left-3 h-4 w-4 text-[color:var(--color-muted-foreground)]"
                strokeWidth={1.9}
                aria-hidden
              />
              <input
                type="search"
                placeholder={t('sidebar.searchPlaceholder')}
                aria-label={t('sidebar.searchAria')}
                className="focus-ring h-9 w-full rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] pr-3 pl-9 text-sm text-[color:var(--color-foreground)] placeholder:text-[color:var(--color-muted-foreground)]"
              />
            </label>

            <div className="flex flex-1 items-center justify-end gap-2 sm:gap-3">
              {eventsCap != null ? (
                <span className="hidden items-center gap-1.5 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-1.5 font-mono text-[10px] tracking-[0.12em] text-[color:var(--color-muted-foreground)] sm:inline-flex">
                  <span
                    aria-hidden
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{ background: dot }}
                  />
                  <b className="text-[color:var(--color-foreground)]">{eventsUsed ?? 0}</b>/
                  {eventsCap} {t('sidebar.weddingsUnit')}
                </span>
              ) : null}

              <StoreNotificationBell />
              <LocaleSwitcher />
            </div>
          </header>

          <main id="main-content" className="flex-1" tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>
    </ThemeProvider>
  );
}
