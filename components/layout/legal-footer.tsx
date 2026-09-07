import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

export function LegalFooter() {
  const t = useTranslations('Footer');
  return (
    <footer
      role="contentinfo"
      className="container-page mt-auto flex flex-col gap-4 border-t border-[color:var(--color-border)] py-8 text-sm text-[color:var(--color-muted)] sm:flex-row sm:items-center sm:justify-between"
    >
      <p>
        © {new Date().getFullYear()} Wedillybird — {t('allRightsReserved')}
      </p>
      <nav aria-label={t('navLabel')} className="flex flex-wrap gap-4">
        <Link href="/legal/terms" className="hover:underline">
          {t('terms')}
        </Link>
        <Link href="/legal/privacy" className="hover:underline">
          {t('privacy')}
        </Link>
        <Link href="/legal/cookies" className="hover:underline">
          {t('cookies')}
        </Link>
        <Link href="/legal/mentions" className="hover:underline">
          {t('mentions')}
        </Link>
        <Link href="/#faq" className="hover:underline">
          {t('faq')}
        </Link>
      </nav>
    </footer>
  );
}
