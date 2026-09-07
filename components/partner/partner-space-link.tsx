'use client';

import { useQuery } from 'convex/react';
import { useTranslations } from 'next-intl';
import { Handshake } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { clientApi } from '@/lib/convex/client-api';
import { useSessionStore } from '@/stores/session-store';
import { cn } from '@/lib/cn';

/**
 * Entrée de navigation vers `/partenaire`, rendue au seul partenaire.
 *
 * Sans elle, la page était orpheline : aucune navigation, aucun lien depuis un
 * dashboard, rien dans l'e-mail d'invitation — un partenaire ne pouvait
 * atteindre son espace qu'en tapant l'URL, alors que les CGU (article 7) lui
 * promettent d'y suivre ses commissions.
 *
 * `userId` est lu depuis le store de session (hydraté par `SessionHydrator`
 * dans le layout `(app)`) plutôt que passé en prop : c'est le même compromis
 * que `StoreNotificationBell`, le shell agence étant rendu par 16 pages.
 * Ne rend rien tant que le store n'est pas hydraté, ni pour un non-partenaire.
 */
export function PartnerSpaceLink({
  variant = 'inline',
  className,
}: {
  /** `sidebar` reprend l'allure des entrées du shell agence. */
  variant?: 'inline' | 'sidebar';
  className?: string;
}) {
  const t = useTranslations('Partner');
  const userId = useSessionStore((s) => s.user?.id);
  const isPartner = useQuery(clientApi.isPartner, userId ? { userId } : 'skip');
  if (!userId || !isPartner) return null;

  return (
    <Link
      href="/partenaire"
      className={cn(
        'focus-ring inline-flex items-center gap-2 rounded-lg text-sm transition-colors',
        variant === 'sidebar'
          ? 'group w-full px-2.5 py-2 text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-surface-elevated)] hover:text-[color:var(--color-foreground)]'
          : 'px-3 py-1.5 font-medium text-[color:var(--color-ink-700)] hover:bg-[color:var(--color-ivory-100)] hover:text-[color:var(--color-ink-900)]',
        className,
      )}
    >
      <Handshake className="h-4 w-4 flex-shrink-0" strokeWidth={2} aria-hidden />
      <span className={variant === 'sidebar' ? 'truncate' : 'hidden sm:inline'}>
        {t('navLink')}
      </span>
    </Link>
  );
}
