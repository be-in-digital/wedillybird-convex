'use client';

import { useDeferredValue, useMemo, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';

/**
 * Socle commun des collections du back-office : recherche plein texte, tri,
 * pagination, barre d'outils et pagineur.
 *
 * `AdminDataTable` (lignes tabulaires) et `AdminCardList` (documents : commandes
 * de livre photo, signalements de bug) partagent exactement ce comportement ;
 * seul le rendu d'un élément diffère. Le factoriser ici évite d'avoir deux
 * champs de recherche qui se mettent à diverger.
 */

export type SortState = { id: string; dir: 'asc' | 'desc' } | null;

export type SortableColumn<T> = {
  id: string;
  sortValue?: (row: T) => string | number | null | undefined;
};

export function useAdminCollection<T>({
  rows,
  searchable,
  columns = [],
  pageSize,
  initialSort = null,
}: {
  rows: readonly T[];
  searchable?: (row: T) => string;
  columns?: readonly SortableColumn<T>[];
  pageSize: number;
  initialSort?: SortState;
}) {
  const [query, setQueryState] = useState('');
  const [sort, setSort] = useState<SortState>(initialSort);
  const [page, setPage] = useState(0);

  // La frappe ne doit pas bloquer le champ pendant le tri/filtrage d'une longue
  // liste : on rend le champ tout de suite, la collection rattrape.
  const deferredQuery = useDeferredValue(query);

  const searched = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    if (!q || !searchable) return rows;
    const terms = q.split(/\s+/);
    return rows.filter((row) => {
      const haystack = searchable(row).toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [rows, deferredQuery, searchable]);

  const sorted = useMemo(() => {
    if (!sort) return searched;
    const column = columns.find((c) => c.id === sort.id);
    if (!column?.sortValue) return searched;
    const factor = sort.dir === 'asc' ? 1 : -1;
    return [...searched].sort((a, b) => {
      const av = column.sortValue!(a);
      const bv = column.sortValue!(b);
      // Les valeurs absentes finissent toujours en bas, quel que soit le sens.
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * factor;
      return String(av).localeCompare(String(bv), 'fr', { numeric: true }) * factor;
    });
  }, [searched, sort, columns]);

  const total = sorted.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  // Filtrer peut faire disparaître la page courante sous les pieds. On borne à
  // la lecture plutôt que de resynchroniser l'état dans un effet : un effet
  // ferait rendre une fois la page hors bornes (donc une liste vide) avant de
  // se corriger, et déclencherait un second rendu en cascade.
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * pageSize;

  return {
    query,
    setQuery: (value: string) => {
      setQueryState(value);
      setPage(0);
    },
    isFiltered: query.trim().length > 0,
    sort,
    toggleSort: (id: string) =>
      setSort((current) => {
        if (current?.id !== id) return { id, dir: 'asc' };
        if (current.dir === 'asc') return { id, dir: 'desc' };
        return null;
      }),
    page: safePage,
    // L'appelant raisonne sur la page bornée : sans ça, un « page précédente »
    // depuis une page devenue hors bornes décrémenterait une valeur invisible
    // et semblerait ne rien faire.
    setPage: (updater: (page: number) => number) =>
      setPage((raw) => {
        const current = Math.min(raw, pageCount - 1);
        return Math.max(0, Math.min(pageCount - 1, updater(current)));
      }),
    pageCount,
    start,
    total,
    visible: sorted.slice(start, start + pageSize),
  };
}

export function AdminToolbar({
  query,
  setQuery,
  searchable,
  searchPlaceholder,
  filters,
  total,
  extra,
}: {
  query: string;
  setQuery: (value: string) => void;
  searchable: boolean;
  searchPlaceholder?: string;
  filters?: ReactNode;
  total: number;
  extra?: ReactNode;
}) {
  const t = useTranslations('Admin');
  if (!searchable && !filters && !extra) return null;

  const placeholder = searchPlaceholder ?? t('table.searchPlaceholder');

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      {searchable ? (
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[color:var(--color-muted-foreground)]"
            strokeWidth={2}
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            aria-label={placeholder}
            className={cn(
              'focus-ring h-10 w-full rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)]',
              'pr-9 pl-9 text-sm text-[color:var(--color-foreground)]',
              'placeholder:text-[color:var(--color-muted-foreground)]',
              '[&::-webkit-search-cancel-button]:hidden',
            )}
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label={t('table.clearSearch')}
              className="focus-ring absolute top-1/2 right-1.5 -translate-y-1/2 rounded-md p-1.5 text-[color:var(--color-muted-foreground)] transition-colors hover:text-[color:var(--color-foreground)]"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
            </button>
          ) : null}
        </div>
      ) : null}

      {filters ? <div className="flex flex-wrap items-center gap-2">{filters}</div> : null}

      <div className="flex items-center gap-3 sm:ml-auto">
        <span className="text-xs text-[color:var(--color-muted-foreground)] tabular-nums">
          {t('table.count', { count: total })}
        </span>
        {extra}
      </div>
    </div>
  );
}

export function AdminPager({
  page,
  setPage,
  pageCount,
  start,
  pageSize,
  total,
}: {
  page: number;
  setPage: (updater: (p: number) => number) => void;
  pageCount: number;
  start: number;
  pageSize: number;
  total: number;
}) {
  const t = useTranslations('Admin');
  if (total <= pageSize) return null;

  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-xs text-[color:var(--color-muted-foreground)] tabular-nums">
        {t('table.range', { from: start + 1, to: Math.min(start + pageSize, total), total })}
      </p>
      <div className="flex items-center gap-1">
        <PagerButton
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          disabled={page === 0}
          label={t('table.previous')}
        >
          <ChevronLeft className="h-4 w-4" strokeWidth={2} aria-hidden />
        </PagerButton>
        <span className="px-2 text-xs text-[color:var(--color-muted-foreground)] tabular-nums">
          {t('table.page', { page: page + 1, pages: pageCount })}
        </span>
        <PagerButton
          onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
          disabled={page >= pageCount - 1}
          label={t('table.next')}
        >
          <ChevronRight className="h-4 w-4" strokeWidth={2} aria-hidden />
        </PagerButton>
      </div>
    </div>
  );
}

function PagerButton({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        'focus-ring inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[color:var(--color-border)]',
        'text-[color:var(--color-muted-foreground)] transition-colors',
        'hover:bg-[color:var(--color-surface-elevated)] hover:text-[color:var(--color-foreground)]',
        'disabled:pointer-events-none disabled:opacity-40',
      )}
    >
      {children}
    </button>
  );
}
