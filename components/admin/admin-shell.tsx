'use client';

import { useEffect, type ReactNode } from 'react';
import { ChevronsUpDown, LogOut, SquareArrowOutUpRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { signOutAction } from '@/app/[locale]/(auth)/actions';
import { cn } from '@/lib/cn';
import { initialsOf } from '@/lib/admin/format';
import { ThemeProvider } from '@/components/ui/theme-provider';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuLabel,
  SidebarProvider,
  SidebarToggle,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import { ADMIN_NAV, adminNavItem, type AdminSection } from './admin-nav';
import { AdminCommandPalette } from './admin-command-palette';

export type { AdminSection };

export interface AdminShellProps {
  children: ReactNode;
  current: AdminSection;
  adminName?: string;
}

/**
 * Shell du back-office super admin (thème dark « Linear-grade », DESIGN.md §2).
 *
 * Structure : rail de navigation groupé et repliable à gauche, barre supérieure
 * collante (fil d'Ariane + palette ⌘K + menu compte), contenu au centre. Sur
 * mobile le rail devient un tiroir — mais c'est le CSS qui tranche, pas un hook
 * de largeur, pour qu'aucune sidebar ne clignote à l'hydratation.
 */
export function AdminShell({ children, current, adminName }: AdminShellProps) {
  return (
    <ThemeProvider theme="dark">
      <div data-theme="dark" className="min-h-dvh bg-[color:var(--color-background)]">
        <SidebarProvider>
          <AdminSidebar current={current} adminName={adminName} />
          <SidebarInset>
            <AdminTopBar current={current} />
            <main className="flex-1">
              <div className="mx-auto w-full max-w-[86rem] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
                {children}
              </div>
            </main>
          </SidebarInset>
        </SidebarProvider>
      </div>
    </ThemeProvider>
  );
}

function AdminSidebar({ current, adminName }: { current: AdminSection; adminName?: string }) {
  const t = useTranslations('Admin');
  const pathname = usePathname();
  const { setOpenMobile, open } = useSidebar();

  // Le tiroir mobile ne se referme pas tout seul : sans ça, on navigue et on
  // retrouve le menu ouvert par-dessus la page qu'on vient de demander.
  useEffect(() => {
    setOpenMobile(false);
  }, [pathname, setOpenMobile]);

  return (
    <Sidebar mobileTitle={t('shell.brand')}>
      {/* Rail replié : la marque cède sa place au bouton de dépli. Reléguer
          celui-ci au pied de la sidebar l'aurait fait changer de place entre les
          deux états — on va rechercher un interrupteur là où on l'a laissé. */}
      <SidebarHeader className={cn(!open && 'md:justify-center md:px-0')}>
        <Link
          href={'/admin' as never}
          className="focus-ring flex min-w-0 items-center gap-2.5 rounded-lg px-1.5 py-1 group-data-[state=collapsed]/sidebar:md:hidden"
        >
          <span
            aria-hidden
            className="font-display flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[color:var(--color-primary-soft)] text-sm leading-none text-[color:var(--color-primary)] italic"
          >
            W
          </span>
          <span className="font-display truncate text-base tracking-tight italic">
            {t('shell.brand')}
          </span>
        </Link>
        <SidebarToggle
          label={t('shell.toggleNav')}
          className="ml-auto hidden group-data-[state=collapsed]/sidebar:mx-auto md:inline-flex"
        />
      </SidebarHeader>

      <SidebarContent>
        {ADMIN_NAV.map((group) => (
          <SidebarGroup key={group.key}>
            <SidebarGroupLabel>{t(group.labelKey)}</SidebarGroupLabel>
            <SidebarMenu>
              {group.items.map((item) => {
                const Icon = item.icon;
                const label = t(item.labelKey);
                return (
                  <SidebarMenuItem key={item.key}>
                    <SidebarMenuButton asChild isActive={item.key === current} tooltip={label}>
                      {/* `aria-label` garantit le nom accessible même en rail
                          replié, où le libellé visible est retiré du flux. */}
                      <Link href={item.href as never} aria-label={label}>
                        <Icon strokeWidth={1.75} aria-hidden />
                        <SidebarMenuLabel>{label}</SidebarMenuLabel>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <AdminAccountMenu adminName={adminName} />
      </SidebarFooter>
    </Sidebar>
  );
}

function AdminAccountMenu({ adminName }: { adminName?: string }) {
  const t = useTranslations('Admin');
  const initials = initialsOf(adminName);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('shell.account')}
          className={cn(
            'focus-ring flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors',
            'hover:bg-[color:var(--color-surface-elevated)]',
            'group-data-[state=collapsed]/sidebar:justify-center group-data-[state=collapsed]/sidebar:px-0',
          )}
        >
          <span
            aria-hidden
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-surface-elevated)] text-[0.6875rem] font-semibold text-[color:var(--color-foreground)]"
          >
            {initials}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium group-data-[state=collapsed]/sidebar:hidden">
            {adminName ?? t('shell.account')}
          </span>
          <ChevronsUpDown
            className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-muted-foreground)] group-data-[state=collapsed]/sidebar:hidden"
            strokeWidth={2}
            aria-hidden
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-56">
        <DropdownMenuLabel>{adminName ?? t('shell.account')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={'/dashboard' as never}>
            <SquareArrowOutUpRight strokeWidth={1.75} aria-hidden />
            {t('shell.backToApp')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <form action={signOutAction}>
          <DropdownMenuItem asChild variant="destructive">
            <button type="submit" className="w-full">
              <LogOut strokeWidth={1.75} aria-hidden />
              {t('shell.signOut')}
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AdminTopBar({ current }: { current: AdminSection }) {
  const t = useTranslations('Admin');
  const item = adminNavItem(current);
  const isOverview = current === 'overview';

  return (
    <header
      className={cn(
        'sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-[color:var(--color-border)]',
        'bg-[color:var(--color-background)]/85 px-3 backdrop-blur sm:px-5',
      )}
    >
      <SidebarTrigger label={t('shell.openNav')} className="md:hidden" />

      <Breadcrumb className="min-w-0 flex-1">
        <BreadcrumbList>
          {isOverview ? (
            <BreadcrumbItem>
              <BreadcrumbPage>{t('nav.overview')}</BreadcrumbPage>
            </BreadcrumbItem>
          ) : (
            <>
              <BreadcrumbItem className="hidden sm:inline-flex">
                <BreadcrumbLink asChild>
                  <Link href={'/admin' as never}>{t('shell.brand')}</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden sm:inline-flex" />
              <BreadcrumbItem>
                <BreadcrumbPage>{item ? t(item.labelKey) : t('shell.brand')}</BreadcrumbPage>
              </BreadcrumbItem>
            </>
          )}
        </BreadcrumbList>
      </Breadcrumb>

      <AdminCommandPalette current={current} />
    </header>
  );
}
