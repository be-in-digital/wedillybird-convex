'use client';

import { useState, useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check, LogIn, Menu, X } from 'lucide-react';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { buttonVariants } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import { LOCALE_FLAGS, LOCALE_NATIVE_NAMES, routing, type Locale } from '@/i18n/routing';
import { useCurrencyStore } from '@/stores/currency-store';
import { cn } from '@/lib/cn';
import { analytics } from '@/lib/analytics/posthog-client';

const SECTION_ITEMS: ReadonlyArray<{ id: string; key: string }> = [
  { id: 'features', key: 'features' },
  { id: 'pricing', key: 'pricing' },
  { id: 'faq', key: 'faq' },
];

/**
 * Mobile menu — déclenché par hamburger sur header mobile.
 * Bottom-sheet (Vaul) qui héberge « Se connecter », la section nav et le
 * sélecteur de langue (rendu en grille de pills tactiles, pas en dropdown). Le
 * CTA sign-up reste visible dans le header (à côté du hamburger). Sur md+ ce
 * composant est rendu invisible.
 *
 * « Se connecter » ouvre la feuille : sous 640px la barre sticky est pleine au
 * pixel près (logo + CTA + hamburger), donc c'est le seul endroit où un compte
 * existant peut le trouver — et c'est précisément ce qu'on ne trouvait pas.
 * D'où sa place en TÊTE, avant les ancres de section.
 */
export function MobileMenu() {
  const t = useTranslations('Landing.mobileMenu');
  const tNav = useTranslations('Landing.sectionNav');
  const tCommon = useTranslations('Common');
  const [open, setOpen] = useState(false);
  const currentLocale = useLocale() as Locale;
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function onLocaleSelect(next: Locale) {
    if (next === currentLocale) {
      setOpen(false);
      return;
    }
    // Changer de langue réinitialise l'override devise : la nouvelle locale
    // impose sa devise par défaut (en → USD, langues européennes → EUR).
    useCurrencyStore.getState().clearCurrency();
    startTransition(() => {
      router.replace(pathname, { locale: next });
      setOpen(false);
    });
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger
        className="focus-ring -mr-2 inline-flex h-11 w-11 items-center justify-center rounded-full text-[color:var(--color-ink-900)] [@media(hover:hover)]:hover:bg-[color:var(--color-ivory-200)]"
        aria-label={t('open')}
      >
        <Menu className="h-6 w-6" strokeWidth={1.5} aria-hidden />
      </DrawerTrigger>
      <DrawerContent>
        <div className="flex items-center justify-between pb-2">
          <DrawerTitle className="font-mono text-[10px] tracking-[0.32em] text-[color:var(--color-ink-500)] uppercase not-italic">
            {t('title')}
          </DrawerTitle>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-full text-[color:var(--color-ink-900)] [@media(hover:hover)]:hover:bg-[color:var(--color-ivory-200)]"
            aria-label={t('close')}
          >
            <X className="h-5 w-5" strokeWidth={1.5} aria-hidden />
          </button>
        </div>

        <div className="border-b border-[color:var(--color-border)] pt-2 pb-5">
          <span className="mb-3 inline-block font-mono text-[10px] tracking-[0.32em] text-[color:var(--color-ink-500)] uppercase">
            {t('account')}
          </span>
          <Link
            href="/sign-in"
            onClick={() => {
              analytics.ctaClicked({ source: 'mobile_menu', destination: '/sign-in' });
              setOpen(false);
            }}
            className={cn(
              buttonVariants({ variant: 'outline', size: 'lg' }),
              'w-full justify-center',
            )}
          >
            <LogIn className="h-4 w-4" strokeWidth={1.75} aria-hidden />
            {tCommon('signIn')}
          </Link>
        </div>

        <nav aria-label={t('navAriaLabel')} className="flex flex-col gap-1 pt-5 pb-2">
          {SECTION_ITEMS.map((item) => (
            <Link
              key={item.id}
              href={`/#${item.id}` as never}
              onClick={() => {
                analytics.ctaClicked({
                  source: 'nav',
                  destination: `#${item.id}`,
                  label: tNav(item.key),
                });
                setOpen(false);
              }}
              className="focus-ring font-display rounded-2xl px-4 py-4 text-2xl text-[color:var(--color-ink-900)] italic [@media(hover:hover)]:hover:bg-[color:var(--color-ivory-200)]"
            >
              {tNav(item.key)}
            </Link>
          ))}
        </nav>

        <div className="mt-4 border-t border-[color:var(--color-border)] pt-5 pb-2">
          <span className="mb-3 inline-block font-mono text-[10px] tracking-[0.32em] text-[color:var(--color-ink-500)] uppercase">
            {t('language')}
          </span>
          <ul role="listbox" aria-label={t('languageAriaLabel')} className="grid grid-cols-2 gap-2">
            {routing.locales.map((loc) => {
              const isCurrent = loc === currentLocale;
              return (
                <li key={loc}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isCurrent}
                    disabled={isPending}
                    onClick={() => onLocaleSelect(loc)}
                    className={cn(
                      'focus-ring flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left text-base transition-colors disabled:opacity-60',
                      isCurrent
                        ? 'border-[color:var(--color-primary)] bg-[color:var(--color-primary)]/5 font-medium text-[color:var(--color-ink-900)]'
                        : 'border-[color:var(--color-border)] text-[color:var(--color-ink-700)] [@media(hover:hover)]:hover:border-[color:var(--color-border-strong)] [@media(hover:hover)]:hover:bg-[color:var(--color-ivory-200)]',
                    )}
                  >
                    <span aria-hidden className="text-xl leading-none">
                      {LOCALE_FLAGS[loc]}
                    </span>
                    <span className="flex-1">{LOCALE_NATIVE_NAMES[loc]}</span>
                    {isCurrent ? (
                      <Check
                        className="h-4 w-4 text-[color:var(--color-primary)]"
                        strokeWidth={2.5}
                        aria-hidden
                      />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
