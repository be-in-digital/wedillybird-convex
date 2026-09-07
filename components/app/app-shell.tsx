import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { LogOut } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { signOutAction } from '@/app/[locale]/(auth)/actions';
import { LocaleSwitcher } from '@/components/layout/locale-switcher';
import { WedillybirdLogo } from '@/components/brand/wedillybird-logo';
import { getSession } from '@/lib/auth/session';
import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';
import { NotificationBell } from '@/components/notifications/notification-bell';
import { PartnerSpaceLink } from '@/components/partner/partner-space-link';

/**
 * AppShell V4 — header sticky réutilisable pour toutes les pages app
 * authenticated (dashboard, events/*, etc.).
 *
 * Pattern Linear / Mercury : brand gauche, nav éditoriale au centre (gérée
 * par les pages enfants via la prop nav), bouton sign-out discret droite.
 *
 * Server component pour préserver le SSR partout. Pas d'animations ici —
 * les pages enfants animent leur propre contenu.
 */
export interface AppShellProps {
  /** Contenu principal de la page. */
  children: ReactNode;
  /**
   * Nav optionnelle au centre du header (breadcrumb, tabs, etc.). Rendue
   * entre le brand et le user menu. Server-renderable.
   */
  nav?: ReactNode;
  /** Nom de l'utilisateur affiché en discret avant le bouton signOut. */
  userName?: string;
}

export async function AppShell({ children, nav, userName }: AppShellProps) {
  const tCommon = await getTranslations('Common');
  const session = await getSession();
  // Lecture volontairement minuscule (un index, aucun ledger) — elle est faite
  // sur chaque page de l'app. Un backend indisponible ne doit pas faire tomber
  // le shell : sans réponse, on n'affiche simplement pas le lien.
  let isPartner = false;
  if (session) {
    try {
      isPartner = await getConvexServerClient().query(convexApi.isPartner, {
        userId: session.userId,
      });
    } catch {
      isPartner = false;
    }
  }

  return (
    <div className="paper-grain flex min-h-screen flex-col bg-[color:var(--color-ivory-50)]">
      <header className="sticky top-0 z-30 border-b border-[color:var(--color-border)] bg-[color:var(--color-ivory-50)]/85 backdrop-blur supports-[backdrop-filter]:bg-[color:var(--color-ivory-50)]/65">
        <div className="container-page flex items-center justify-between gap-6 py-4">
          <div className="flex items-center gap-8">
            <Link
              href="/dashboard"
              className="focus-ring inline-flex items-center"
              aria-label={tCommon('appName')}
            >
              <WedillybirdLogo />
            </Link>
            {nav}
          </div>

          <div className="flex items-center gap-3">
            {/* Rendu SERVEUR : le lien fait partie de la page dès le premier
                octet, sans dépendre d'une connexion temps réel. Sans lui,
                `/partenaire` reste inatteignable autrement qu'en tapant l'URL. */}
            {isPartner ? <PartnerSpaceLink /> : null}
            {session ? <NotificationBell userId={session.userId} /> : null}
            {userName ? (
              <span className="hidden font-mono text-[10px] tracking-[0.24em] text-[color:var(--color-ink-500)] uppercase sm:inline-block">
                {userName}
              </span>
            ) : null}
            <LocaleSwitcher />
            <span aria-hidden className="hidden h-5 w-px bg-[color:var(--color-border)] sm:block" />
            <form action={signOutAction}>
              <button
                type="submit"
                className="focus-ring inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-[color:var(--color-ink-700)] transition-colors hover:bg-[color:var(--color-ivory-100)] hover:text-[color:var(--color-ink-900)]"
                aria-label={tCommon('signOut')}
              >
                <LogOut className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                <span className="hidden sm:inline">{tCommon('signOut')}</span>
              </button>
            </form>
          </div>
        </div>
      </header>

      <main id="main-content" className="flex-1" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
