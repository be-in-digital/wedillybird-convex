import { getTranslations } from 'next-intl/server';
import { Handshake } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/cn';

/**
 * Lien vers `/partenaire`. Purement présentationnel : c'est l'appelant qui
 * décide s'il faut l'afficher, parce que lui seul sait à quel coût il peut
 * répondre à la question « cette personne est-elle partenaire ? ».
 *
 * Sans ce lien, la page était orpheline — aucune navigation, aucun lien depuis
 * un dashboard, rien dans l'e-mail d'invitation. Un partenaire ne pouvait
 * l'atteindre qu'en tapant l'URL, alors que l'article 7 des CGU la lui promet.
 */
export async function PartnerSpaceLink({
  variant = 'inline',
  className,
}: {
  /** `sidebar` reprend l'allure des entrées du shell agence. */
  variant?: 'inline' | 'sidebar';
  className?: string;
}) {
  const t = await getTranslations('Partner');
  return (
    <Link
      href="/partenaire"
      data-testid="partner-space-link"
      className={cn(
        'focus-ring inline-flex items-center gap-2 rounded-lg text-sm transition-colors',
        variant === 'sidebar'
          ? 'w-full px-2.5 py-2 text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-surface-elevated)] hover:text-[color:var(--color-foreground)]'
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
