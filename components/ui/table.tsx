import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/**
 * Table (shadcn) thémée sur les tokens OKLCH — donc lisible en dark agence comme
 * en light éditorial. Le scroll horizontal est porté par `TableScroll` et non par
 * `Table` : sur mobile le back-office bascule en cartes (cf. `AdminDataTable`),
 * le scroll latéral n'est qu'un filet de sécurité pour les tableaux très larges.
 */

export function TableScroll({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'w-full overflow-x-auto overscroll-x-contain rounded-[inherit]',
        // Barre fine et discrète plutôt que la barre système épaisse.
        '[scrollbar-color:var(--color-border-strong)_transparent] [scrollbar-width:thin]',
        className,
      )}
      {...props}
    />
  );
}

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <table className={cn('w-full caption-bottom border-collapse text-sm', className)} {...props} />
  );
}

export function TableHeader({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('[&_tr]:border-b', className)} {...props} />;
}

export function TableBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />;
}

export function TableFooter({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tfoot
      className={cn(
        'border-t border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)]/60 font-medium',
        className,
      )}
      {...props}
    />
  );
}

export function TableRow({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        'border-b border-[color:var(--color-border)] transition-colors',
        'hover:bg-[color:var(--color-surface-elevated)]/60',
        'data-[state=selected]:bg-[color:var(--color-primary-soft)]/50',
        className,
      )}
      {...props}
    />
  );
}

export function TableHead({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        'h-10 px-3 text-left align-middle text-[0.6875rem] font-semibold tracking-[0.08em] text-[color:var(--color-muted-foreground)] uppercase',
        'whitespace-nowrap',
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-3 py-2.5 align-middle', className)} {...props} />;
}

export function TableCaption({ className, ...props }: HTMLAttributes<HTMLTableCaptionElement>) {
  return (
    <caption
      className={cn('mt-4 text-sm text-[color:var(--color-muted-foreground)]', className)}
      {...props}
    />
  );
}
