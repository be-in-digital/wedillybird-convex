'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { AdminEmptyState } from './empty-state';
import { AdminPager, AdminToolbar, useAdminCollection } from './collection';

/**
 * Liste de documents : même barre d'outils, même pagination et même état vide
 * que `AdminDataTable`, mais **un seul rendu** — chaque élément est une carte à
 * toutes les largeurs.
 *
 * À préférer quand un élément n'est pas une ligne de tableau mais un document
 * (commande de livre photo avec son adresse postale, signalement de bug avec sa
 * pile d'erreurs) : le mettre en colonnes le tronquerait, et le double rendu du
 * `AdminDataTable` dupliquerait des nœuds qu'on n'a aucune raison de dupliquer.
 */
export function AdminCardList<T>({
  rows,
  getRowId,
  renderCard,
  searchable,
  searchPlaceholder,
  filters,
  pageSize = 25,
  emptyTitle,
  emptyDescription,
  emptyIcon,
  toolbarExtra,
  className,
}: {
  rows: readonly T[];
  getRowId: (row: T) => string;
  renderCard: (row: T) => ReactNode;
  searchable?: (row: T) => string;
  searchPlaceholder?: string;
  filters?: ReactNode;
  pageSize?: number;
  emptyTitle: string;
  emptyDescription?: ReactNode;
  emptyIcon?: Parameters<typeof AdminEmptyState>[0]['icon'];
  toolbarExtra?: ReactNode;
  className?: string;
}) {
  const t = useTranslations('Admin');
  const collection = useAdminCollection({ rows, searchable, pageSize });

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <AdminToolbar
        query={collection.query}
        setQuery={collection.setQuery}
        searchable={Boolean(searchable)}
        searchPlaceholder={searchPlaceholder}
        filters={filters}
        total={collection.total}
        extra={toolbarExtra}
      />

      {collection.total === 0 ? (
        <div className="rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)]">
          <AdminEmptyState
            icon={emptyIcon}
            title={collection.isFiltered ? t('table.noMatchTitle') : emptyTitle}
            description={collection.isFiltered ? t('table.noMatchDescription') : emptyDescription}
            compact
          />
        </div>
      ) : (
        <>
          <ul className="flex flex-col gap-2.5">
            {collection.visible.map((row) => (
              <li key={getRowId(row)}>{renderCard(row)}</li>
            ))}
          </ul>
          <AdminPager
            page={collection.page}
            setPage={collection.setPage}
            pageCount={collection.pageCount}
            start={collection.start}
            pageSize={pageSize}
            total={collection.total}
          />
        </>
      )}
    </div>
  );
}
