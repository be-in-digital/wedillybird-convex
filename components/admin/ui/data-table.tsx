'use client';

import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@/components/ui/table';
import { AdminEmptyState } from './empty-state';
import { AdminPager, AdminToolbar, useAdminCollection } from './collection';

/**
 * Tableau de données du back-office : tri, recherche, filtres, pagination et —
 * le point qui manquait le plus — un rendu mobile réel.
 *
 * Les tableaux admin étaient en `min-w-[760px]` dans un `overflow-x-auto` : sur
 * téléphone on ne voyait qu'une colonne et demie et il fallait balayer
 * horizontalement pour lire une ligne. Ici, sous `md`, chaque ligne devient une
 * carte (titre + statut + paires libellé/valeur + actions) ; à partir de `md` on
 * revient au tableau dense, qui est le bon outil sur grand écran.
 *
 * Les deux rendus coexistent dans le DOM et c'est le CSS qui tranche : décider
 * en JS ferait clignoter le mauvais rendu le temps de l'hydratation. Le coût est
 * borné par la pagination (25 lignes par défaut). Pour une collection dont les
 * éléments sont des documents plutôt que des lignes, préférer `AdminCardList` —
 * un seul rendu, donc un seul nœud par élément.
 *
 * Le rôle de chaque colonne dans la carte se déclare via `card`.
 */

export type AdminColumn<T> = {
  id: string;
  /** Libellé d'en-tête. Sert aussi de libellé dans la carte mobile. */
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Fournir une valeur rend la colonne triable ; l'omettre la laisse figée. */
  sortValue?: (row: T) => string | number | null | undefined;
  align?: 'left' | 'right';
  /** Masque la colonne sous ce palier (le tableau lui-même ne démarre qu'à `md`). */
  hideBelow?: 'lg' | 'xl';
  className?: string;
  headClassName?: string;
  /** Place de la colonne dans la carte mobile. Défaut : `meta`. */
  card?: 'title' | 'badge' | 'meta' | 'actions' | 'hidden';
  /** Largeur fixe (`w-32`…) pour éviter que les colonnes d'actions ne dansent. */
  width?: string;
};

const HIDE_BELOW: Record<NonNullable<AdminColumn<unknown>['hideBelow']>, string> = {
  lg: 'hidden lg:table-cell',
  xl: 'hidden xl:table-cell',
};

export function AdminDataTable<T>({
  rows,
  columns,
  getRowId,
  searchable,
  searchPlaceholder,
  filters,
  pageSize = 25,
  emptyTitle,
  emptyDescription,
  emptyIcon,
  emptyAction,
  initialSort,
  toolbarExtra,
  rowClassName,
  className,
}: {
  rows: readonly T[];
  columns: readonly AdminColumn<T>[];
  getRowId: (row: T) => string;
  /** Chaîne dans laquelle la recherche plein texte va chercher. Omise = pas de champ. */
  searchable?: (row: T) => string;
  searchPlaceholder?: string;
  /** Contrôles de filtrage (selects…), rendus dans la barre d'outils. */
  filters?: ReactNode;
  pageSize?: number;
  emptyTitle: string;
  emptyDescription?: ReactNode;
  emptyIcon?: Parameters<typeof AdminEmptyState>[0]['icon'];
  emptyAction?: ReactNode;
  initialSort?: { id: string; dir: 'asc' | 'desc' };
  /** Contenu additionnel à droite de la barre d'outils (export, action de masse…). */
  toolbarExtra?: ReactNode;
  rowClassName?: (row: T) => string | undefined;
  className?: string;
}) {
  const t = useTranslations('Admin');
  const collection = useAdminCollection({
    rows,
    searchable,
    columns,
    pageSize,
    initialSort: initialSort ?? null,
  });
  const { visible, total, sort, toggleSort, isFiltered } = collection;

  const titleColumn = columns.find((c) => c.card === 'title') ?? columns[0];
  const badgeColumns = columns.filter((c) => c.card === 'badge');
  const actionColumns = columns.filter((c) => c.card === 'actions');
  const metaColumns = columns.filter(
    (c) => c !== titleColumn && (c.card === undefined || c.card === 'meta'),
  );

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <AdminToolbar
        query={collection.query}
        setQuery={collection.setQuery}
        searchable={Boolean(searchable)}
        searchPlaceholder={searchPlaceholder}
        filters={filters}
        total={total}
        extra={toolbarExtra}
      />

      {total === 0 ? (
        <div className="rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)]">
          <AdminEmptyState
            icon={emptyIcon}
            title={isFiltered ? t('table.noMatchTitle') : emptyTitle}
            description={isFiltered ? t('table.noMatchDescription') : emptyDescription}
            action={isFiltered ? null : emptyAction}
            compact
          />
        </div>
      ) : (
        <>
          {/* Mobile : une carte par ligne. */}
          <ul className="flex flex-col gap-2 md:hidden">
            {visible.map((row) => (
              <li
                key={getRowId(row)}
                className={cn(
                  'rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3.5',
                  rowClassName?.(row),
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 text-sm font-medium">{titleColumn?.cell(row)}</div>
                  {badgeColumns.length > 0 ? (
                    <div className="flex shrink-0 flex-wrap justify-end gap-1">
                      {badgeColumns.map((c) => (
                        <span key={c.id}>{c.cell(row)}</span>
                      ))}
                    </div>
                  ) : null}
                </div>

                {metaColumns.length > 0 ? (
                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
                    {metaColumns.map((c) => (
                      <div key={c.id} className="min-w-0">
                        <dt className="text-[0.625rem] font-semibold tracking-[0.08em] text-[color:var(--color-muted-foreground)] uppercase">
                          {c.header}
                        </dt>
                        <dd className="mt-0.5 truncate text-sm">{c.cell(row)}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}

                {actionColumns.length > 0 ? (
                  <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-[color:var(--color-border)] pt-3">
                    {actionColumns.map((c) => (
                      <span key={c.id}>{c.cell(row)}</span>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>

          {/* Desktop : tableau dense. */}
          <div className="hidden overflow-hidden rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] md:block">
            <TableScroll>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    {columns.map((column) => {
                      const sortable = Boolean(column.sortValue);
                      const active = sort?.id === column.id;
                      return (
                        <TableHead
                          key={column.id}
                          aria-sort={
                            active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined
                          }
                          className={cn(
                            column.align === 'right' && 'text-right',
                            column.hideBelow && HIDE_BELOW[column.hideBelow],
                            column.width,
                            column.headClassName,
                          )}
                        >
                          {sortable ? (
                            <button
                              type="button"
                              onClick={() => toggleSort(column.id)}
                              className={cn(
                                'focus-ring -mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors',
                                'hover:text-[color:var(--color-foreground)]',
                                active && 'text-[color:var(--color-foreground)]',
                                column.align === 'right' && 'flex-row-reverse',
                              )}
                            >
                              {column.header}
                              {active ? (
                                sort!.dir === 'asc' ? (
                                  <ArrowUp className="h-3 w-3" strokeWidth={2.5} aria-hidden />
                                ) : (
                                  <ArrowDown className="h-3 w-3" strokeWidth={2.5} aria-hidden />
                                )
                              ) : (
                                <ChevronsUpDown
                                  className="h-3 w-3 opacity-40"
                                  strokeWidth={2}
                                  aria-hidden
                                />
                              )}
                            </button>
                          ) : (
                            column.header
                          )}
                        </TableHead>
                      );
                    })}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((row) => (
                    <TableRow key={getRowId(row)} className={rowClassName?.(row)}>
                      {columns.map((column) => (
                        <TableCell
                          key={column.id}
                          className={cn(
                            column.align === 'right' && 'text-right',
                            column.hideBelow && HIDE_BELOW[column.hideBelow],
                            column.className,
                          )}
                        >
                          {column.cell(row)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableScroll>
          </div>

          <AdminPager
            page={collection.page}
            setPage={collection.setPage}
            pageCount={collection.pageCount}
            start={collection.start}
            pageSize={pageSize}
            total={total}
          />
        </>
      )}
    </div>
  );
}
