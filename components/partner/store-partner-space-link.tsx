'use client';

import { useQuery } from 'convex/react';
import { useTranslations } from 'next-intl';
import { Handshake } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { clientApi } from '@/lib/convex/client-api';
import { useSessionStore } from '@/stores/session-store';
import { cn } from '@/lib/cn';

/**
 * Variante client du lien vers `/partenaire`, pour le shell agence.
 *
 * `userId` est lu depuis le store de session (hydraté par `SessionHydrator`
 * dans le layout `(app)`) plutôt que passé en prop : même compromis que
 * `StoreNotificationBell`, le shell étant rendu par 16 pages. Ne rend rien tant
 * que le store n'est pas hydraté, ni pour un non-partenaire.
 *
 * Le rendu est dupliqué plutôt que délégué à `PartnerSpaceLink` : celui-ci est
 * un composant serveur (`getTranslations`), inappelable depuis un client.
 */
export function StorePartnerSpaceLink({ className }: { className?: string }) {
  const t = useTranslations('Partner');
  const userId = useSessionStore((s) => s.user?.id);
  const isPartner = useQuery(clientApi.isPartner, userId ? { userId } : 'skip');
  if (!userId || !isPartner) return null;

  return (
    <Link
      href="/partenaire"
      data-testid="partner-space-link"
      className={cn(
        'focus-ring inline-flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-surface-elevated)] hover:text-[color:var(--color-foreground)]',
        className,
      )}
    >
      <Handshake className="h-4 w-4 flex-shrink-0" strokeWidth={2} aria-hidden />
      <span className="truncate">{t('navLink')}</span>
    </Link>
  );
}
