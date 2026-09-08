import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Bloc de section : titre h2 + description + actions, puis contenu encadré.
 *
 * `bare` rend le contenu sans carte — indispensable pour ne pas empiler une
 * carte dans une carte quand le contenu est déjà un tableau bordé ou une grille
 * de tuiles.
 */
export function AdminSection({
  title,
  description,
  actions,
  children,
  bare = false,
  contentClassName,
  className,
  id,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  bare?: boolean;
  contentClassName?: string;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 className="font-sans text-[0.9375rem] leading-tight font-semibold tracking-[-0.005em] text-[color:var(--color-foreground)] not-italic">
            {title}
          </h2>
          {description ? (
            <p className="mt-1 max-w-[70ch] text-sm text-[color:var(--color-muted-foreground)]">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>

      {bare ? (
        <div className={contentClassName}>{children}</div>
      ) : (
        <div
          className={cn(
            'rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)]',
            contentClassName,
          )}
        >
          {children}
        </div>
      )}
    </section>
  );
}

/** Conteneur vertical d'une page admin — rythme d'espacement unique du back-office. */
export function AdminPage({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-col gap-8', className)}>{children}</div>;
}
