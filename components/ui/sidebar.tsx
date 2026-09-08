'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { PanelLeft } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Sheet, SheetContent } from './sheet';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip';

/**
 * Sidebar (pattern shadcn) adaptée aux tokens OKLCH du projet.
 *
 * Deux différences assumées avec le bloc shadcn d'origine :
 *
 * 1. **Aucune décision de layout ne dépend de JS.** Le rail desktop et le tiroir
 *    mobile sont tous deux montés ; c'est `hidden md:flex` / `md:hidden` qui
 *    tranche. Un hook de largeur trancherait après l'hydratation → flash de
 *    sidebar sur mobile. `useIsMobile` ne sert donc qu'à refermer le tiroir.
 * 2. **L'état replié est persisté en `localStorage`**, pas en cookie : la zone
 *    admin est entièrement cliente pour la navigation, aucun rendu serveur n'a
 *    besoin de connaître l'état. Il est lu via `useSyncExternalStore` — le
 *    serveur ne connaît pas la préférence, et resynchroniser dans un effet
 *    ferait rendre une fois la mauvaise largeur avant de se corriger.
 */

const SIDEBAR_WIDTH = '15.5rem';
const SIDEBAR_WIDTH_ICON = '3.5rem';
const STORAGE_KEY = 'wbb:sidebar:collapsed';

/**
 * `localStorage` vu comme un store externe : un abonnement, un instantané
 * client, un instantané serveur. L'événement `storage` synchronise en prime les
 * autres onglets, et `wbb:sidebar` le reste de cet onglet.
 */
const collapsedListeners = new Set<() => void>();

function subscribeCollapsed(onChange: () => void): () => void {
  collapsedListeners.add(onChange);
  window.addEventListener('storage', onChange);
  return () => {
    collapsedListeners.delete(onChange);
    window.removeEventListener('storage', onChange);
  };
}

function getCollapsedSnapshot(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    // localStorage indisponible (mode privé strict) : on retombe sur le défaut.
    return false;
  }
}

function writeCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
  } catch {
    /* idem : la préférence ne sera simplement pas mémorisée. */
  }
  for (const listener of collapsedListeners) listener();
}

type SidebarContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  openMobile: boolean;
  setOpenMobile: (open: boolean) => void;
  toggleSidebar: () => void;
};

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function useSidebar(): SidebarContextValue {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error('useSidebar doit être utilisé dans un <SidebarProvider>.');
  return ctx;
}

export function SidebarProvider({
  children,
  className,
  defaultOpen = true,
  ...props
}: ComponentProps<'div'> & { defaultOpen?: boolean }) {
  const [openMobile, setOpenMobile] = useState(false);

  const collapsed = useSyncExternalStore(
    subscribeCollapsed,
    getCollapsedSnapshot,
    // Instantané serveur : la préférence est inconnue, on rend le défaut.
    () => !defaultOpen,
  );
  const open = !collapsed;

  const setOpen = useCallback((next: boolean) => writeCollapsed(!next), []);
  const toggleSidebar = useCallback(() => writeCollapsed(open), [open]);

  const value = useMemo<SidebarContextValue>(
    () => ({ open, setOpen, openMobile, setOpenMobile, toggleSidebar }),
    [open, setOpen, openMobile, toggleSidebar],
  );

  return (
    <SidebarContext.Provider value={value}>
      <TooltipProvider delayDuration={200}>
        <div
          data-slot="sidebar-wrapper"
          style={
            {
              '--sidebar-width': SIDEBAR_WIDTH,
              '--sidebar-width-icon': SIDEBAR_WIDTH_ICON,
            } as React.CSSProperties
          }
          className={cn(
            'flex min-h-dvh w-full bg-[color:var(--color-background)] text-[color:var(--color-foreground)]',
            className,
          )}
          {...props}
        >
          {children}
        </div>
      </TooltipProvider>
    </SidebarContext.Provider>
  );
}

/**
 * Le rail desktop (`hidden md:flex`) et le tiroir mobile (`md:hidden`) sont tous
 * deux rendus ; `children` est donc monté deux fois. C'est voulu : le contenu de
 * navigation est pur (liens + libellés), et cela évite tout saut de layout.
 */
export function Sidebar({
  children,
  className,
  mobileTitle,
}: {
  children: ReactNode;
  className?: string;
  /** Titre annoncé aux lecteurs d'écran pour le tiroir mobile. */
  mobileTitle: string;
}) {
  const { open, openMobile, setOpenMobile } = useSidebar();

  return (
    <>
      <aside
        data-state={open ? 'expanded' : 'collapsed'}
        className={cn(
          'group/sidebar sticky top-0 hidden h-dvh shrink-0 flex-col md:flex',
          'border-r border-[color:var(--color-border)] bg-[color:var(--color-surface)]',
          'transition-[width] duration-300 ease-[var(--ease-out-quint)]',
          'w-[var(--sidebar-width)] data-[state=collapsed]:w-[var(--sidebar-width-icon)]',
          className,
        )}
      >
        {children}
      </aside>

      <Sheet open={openMobile} onOpenChange={setOpenMobile}>
        <SheetContent
          side="left"
          showClose={false}
          label={mobileTitle}
          className="w-[86vw] max-w-[17rem] bg-[color:var(--color-surface)] p-0 md:hidden"
        >
          <div className="group/sidebar flex h-full flex-col" data-state="expanded">
            {children}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

/** Colonne de contenu, à droite du rail. `min-w-0` : sinon les tableaux la débordent. */
export function SidebarInset({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex min-w-0 flex-1 flex-col', className)} {...props} />;
}

export function SidebarHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex h-14 shrink-0 items-center gap-2 border-b border-[color:var(--color-border)] px-3',
        className,
      )}
      {...props}
    />
  );
}

export function SidebarContent({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex min-h-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto py-4',
        '[scrollbar-color:var(--color-border-strong)_transparent] [scrollbar-width:thin]',
        className,
      )}
      {...props}
    />
  );
}

export function SidebarFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('shrink-0 border-t border-[color:var(--color-border)] p-2', className)}
      {...props}
    />
  );
}

export function SidebarGroup({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1 px-2', className)} {...props} />;
}

export function SidebarGroupLabel({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'px-2.5 pb-0.5 text-[0.6875rem] font-semibold tracking-[0.08em] text-[color:var(--color-muted-foreground)] uppercase',
        // En mode icône le libellé de groupe disparaît : la barre le remplace.
        'transition-opacity duration-200',
        'group-data-[state=collapsed]/sidebar:pointer-events-none group-data-[state=collapsed]/sidebar:h-0 group-data-[state=collapsed]/sidebar:overflow-hidden group-data-[state=collapsed]/sidebar:opacity-0',
        className,
      )}
      {...props}
    />
  );
}

export function SidebarMenu({ className, ...props }: ComponentProps<'ul'>) {
  return <ul className={cn('flex w-full flex-col gap-0.5', className)} {...props} />;
}

export function SidebarMenuItem({ className, ...props }: ComponentProps<'li'>) {
  return <li className={cn('relative', className)} {...props} />;
}

const sidebarMenuButtonVariants = cva(
  cn(
    'focus-ring group/btn flex w-full items-center gap-3 overflow-hidden rounded-lg text-sm font-medium',
    'transition-colors duration-150 outline-none',
    'disabled:pointer-events-none disabled:opacity-50',
    '[&>svg]:h-4 [&>svg]:w-4 [&>svg]:shrink-0',
    // Repliée, la puce devient un carré centré à la largeur du rail.
    'group-data-[state=collapsed]/sidebar:justify-center group-data-[state=collapsed]/sidebar:px-0',
  ),
  {
    variants: {
      variant: {
        default: cn(
          'text-[color:var(--color-muted-foreground)]',
          'hover:bg-[color:var(--color-surface-elevated)] hover:text-[color:var(--color-foreground)]',
          'data-[active=true]:bg-[color:var(--color-primary-soft)] data-[active=true]:text-[color:var(--color-primary)]',
        ),
        ghost:
          'text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-surface-elevated)] hover:text-[color:var(--color-foreground)]',
      },
      size: {
        // 40px : au-dessus du seuil tactile une fois le tiroir mobile ouvert.
        default: 'h-10 px-2.5',
        sm: 'h-8 px-2 text-[0.8125rem]',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export function SidebarMenuButton({
  className,
  asChild,
  isActive,
  tooltip,
  variant,
  size,
  children,
  ...props
}: ComponentProps<'button'> &
  VariantProps<typeof sidebarMenuButtonVariants> & {
    asChild?: boolean;
    isActive?: boolean;
    /** Libellé montré au survol quand la sidebar est repliée en rail d'icônes. */
    tooltip?: string;
  }) {
  const { open } = useSidebar();
  const Comp = asChild ? Slot : 'button';

  const button = (
    <Comp
      data-active={isActive ? 'true' : undefined}
      aria-current={isActive ? 'page' : undefined}
      className={cn(sidebarMenuButtonVariants({ variant, size }), className)}
      {...props}
    >
      {children}
    </Comp>
  );

  if (!tooltip) return button;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      {/* Le tooltip ne sert qu'au rail replié — déplié, le libellé est déjà lisible. */}
      <TooltipContent side="right" hidden={open} className="md:block">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

/** Libellé d'une entrée : masqué (et retiré du flux) quand la sidebar est repliée. */
export function SidebarMenuLabel({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'min-w-0 flex-1 truncate text-left',
        'group-data-[state=collapsed]/sidebar:hidden',
        className,
      )}
      {...props}
    />
  );
}

/** Compteur/pastille aligné à droite d'une entrée. Masqué en rail replié. */
export function SidebarMenuBadge({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'ml-auto shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[0.625rem] tabular-nums',
        'bg-[color:var(--color-danger-soft)] text-[color:color-mix(in_oklab,var(--color-danger),var(--color-foreground)_40%)]',
        'group-data-[state=collapsed]/sidebar:hidden',
        className,
      )}
      {...props}
    />
  );
}

export function SidebarSeparator({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      role="presentation"
      className={cn('mx-2 my-1 h-px bg-[color:var(--color-border)]', className)}
      {...props}
    />
  );
}

/** Bouton de repli/dépli du rail (desktop) — pas d'équivalent mobile, le tiroir se ferme. */
export function SidebarToggle({ className, label }: { className?: string; label: string }) {
  const { open, toggleSidebar } = useSidebar();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={label}
          aria-expanded={open}
          className={cn(
            'focus-ring inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
            'text-[color:var(--color-muted-foreground)] transition-colors',
            'hover:bg-[color:var(--color-surface-elevated)] hover:text-[color:var(--color-foreground)]',
            className,
          )}
        >
          <PanelLeft className="h-4 w-4" strokeWidth={1.75} aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

/** Ouvre le tiroir de navigation sur mobile. */
export function SidebarTrigger({ className, label }: { className?: string; label: string }) {
  const { setOpenMobile } = useSidebar();
  return (
    <button
      type="button"
      onClick={() => setOpenMobile(true)}
      aria-label={label}
      className={cn(
        'focus-ring inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
        'text-[color:var(--color-muted-foreground)] transition-colors',
        'hover:bg-[color:var(--color-surface-elevated)] hover:text-[color:var(--color-foreground)]',
        className,
      )}
    >
      <PanelLeft className="h-5 w-5" strokeWidth={1.75} aria-hidden />
    </button>
  );
}
