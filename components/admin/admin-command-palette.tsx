'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Search } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/cn';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { ADMIN_NAV, type AdminSection } from './admin-nav';

/**
 * Palette ⌘K du back-office. Quinze sections : à partir de là, viser la sidebar
 * coûte plus cher que taper trois lettres. Le déclencheur visible reste un champ
 * de recherche factice — un raccourci que rien n'annonce n'existe pas.
 */
export function AdminCommandPalette({ current }: { current: AdminSection }) {
  const t = useTranslations('Admin');
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      setOpen((value) => !value);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('shell.search')}
        className={cn(
          'focus-ring inline-flex h-9 items-center gap-2 rounded-lg border border-[color:var(--color-border)]',
          'bg-[color:var(--color-surface)] px-2.5 text-sm text-[color:var(--color-muted-foreground)]',
          'transition-colors hover:border-[color:var(--color-border-strong)] hover:text-[color:var(--color-foreground)]',
        )}
      >
        <Search className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
        <span className="hidden lg:inline">{t('shell.searchHint')}</span>
        <kbd className="ml-1 hidden rounded border border-[color:var(--color-border)] px-1 font-mono text-[0.625rem] lg:inline">
          ⌘K
        </kbd>
      </button>

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title={t('shell.search')}
        description={t('shell.commandSections')}
      >
        <CommandInput placeholder={t('shell.search')} />
        <CommandList>
          <CommandEmpty>{t('shell.commandEmpty')}</CommandEmpty>
          {ADMIN_NAV.map((group) => (
            <CommandGroup key={group.key} heading={t(group.labelKey)}>
              {group.items.map((item) => {
                const Icon = item.icon;
                const label = t(item.labelKey);
                return (
                  <CommandItem
                    key={item.key}
                    // `value` alimente le filtrage de cmdk : on y met aussi le
                    // libellé du groupe pour que « revenus » remonte Paiements.
                    value={`${label} ${t(group.labelKey)}`}
                    onSelect={() => {
                      setOpen(false);
                      router.push(item.href as never);
                    }}
                  >
                    <Icon strokeWidth={1.75} aria-hidden />
                    {label}
                    {item.key === current ? (
                      <span className="ml-auto text-[0.6875rem] text-[color:var(--color-muted-foreground)]">
                        •
                      </span>
                    ) : null}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>
    </>
  );
}
