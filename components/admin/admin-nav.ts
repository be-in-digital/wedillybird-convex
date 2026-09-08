import {
  BarChart3,
  BookOpen,
  Bug,
  Building2,
  CalendarDays,
  CreditCard,
  FileText,
  Handshake,
  LayoutDashboard,
  Mail,
  Megaphone,
  ScrollText,
  Shield,
  Ticket,
  Users,
  type LucideIcon,
} from 'lucide-react';

/**
 * Navigation du back-office admin — **source unique** partagée par la sidebar,
 * le fil d'Ariane et la palette de commandes (⌘K).
 *
 * Les quinze entrées étaient auparavant une liste plate : à cette longueur on ne
 * scanne plus, on lit ligne à ligne. Elles sont regroupées par intention (ce que
 * l'admin vient faire), pas par table Convex.
 */

export type AdminSection =
  | 'overview'
  | 'analytics'
  | 'acquisition'
  | 'payments'
  | 'invoices'
  | 'subscriptions'
  | 'users'
  | 'events'
  | 'photo-books'
  | 'promotions'
  | 'affiliates'
  | 'newsletter'
  | 'moderation'
  | 'audit-log'
  | 'bug-reports';

export type AdminNavItem = {
  key: AdminSection;
  href: string;
  icon: LucideIcon;
  /** Clé i18n dans le namespace `Admin`. */
  labelKey: string;
};

export type AdminNavGroup = {
  key: string;
  /** Clé i18n dans le namespace `Admin`. */
  labelKey: string;
  items: readonly AdminNavItem[];
};

export const ADMIN_NAV: readonly AdminNavGroup[] = [
  {
    key: 'steering',
    labelKey: 'shell.groupSteering',
    items: [
      { key: 'overview', href: '/admin', icon: LayoutDashboard, labelKey: 'nav.overview' },
      { key: 'analytics', href: '/admin/analytics', icon: BarChart3, labelKey: 'nav.analytics' },
      {
        key: 'acquisition',
        href: '/admin/acquisition',
        icon: Megaphone,
        labelKey: 'nav.acquisition',
      },
    ],
  },
  {
    key: 'revenue',
    labelKey: 'shell.groupRevenue',
    items: [
      { key: 'payments', href: '/admin/payments', icon: CreditCard, labelKey: 'nav.payments' },
      { key: 'invoices', href: '/admin/invoices', icon: FileText, labelKey: 'nav.invoices' },
      {
        key: 'subscriptions',
        href: '/admin/subscriptions',
        icon: Building2,
        labelKey: 'nav.subscriptions',
      },
    ],
  },
  {
    key: 'customers',
    labelKey: 'shell.groupCustomers',
    items: [
      { key: 'users', href: '/admin/users', icon: Users, labelKey: 'nav.users' },
      { key: 'events', href: '/admin/events', icon: CalendarDays, labelKey: 'nav.events' },
      {
        key: 'photo-books',
        href: '/admin/photo-books',
        icon: BookOpen,
        labelKey: 'nav.photoBooks',
      },
    ],
  },
  {
    key: 'growth',
    labelKey: 'shell.groupGrowth',
    items: [
      { key: 'promotions', href: '/admin/promotions', icon: Ticket, labelKey: 'nav.promotions' },
      { key: 'affiliates', href: '/admin/affiliates', icon: Handshake, labelKey: 'nav.affiliates' },
      { key: 'newsletter', href: '/admin/newsletter', icon: Mail, labelKey: 'nav.newsletter' },
    ],
  },
  {
    key: 'system',
    labelKey: 'shell.groupSystem',
    items: [
      { key: 'moderation', href: '/admin/moderation', icon: Shield, labelKey: 'nav.moderation' },
      { key: 'audit-log', href: '/admin/audit-log', icon: ScrollText, labelKey: 'nav.auditLog' },
      { key: 'bug-reports', href: '/admin/bug-reports', icon: Bug, labelKey: 'nav.bugReports' },
    ],
  },
] as const;

export const ADMIN_NAV_ITEMS: readonly AdminNavItem[] = ADMIN_NAV.flatMap((g) => g.items);

export function adminNavItem(section: AdminSection): AdminNavItem | undefined {
  return ADMIN_NAV_ITEMS.find((item) => item.key === section);
}
