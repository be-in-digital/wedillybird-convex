import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * En-tête de page du back-office. Remplace les 15 `<header>` copiés-collés qui
 * portaient chacun leur propre `clamp()` inline — les valeurs avaient déjà
 * divergé (2,5 rem sur la vue d'ensemble, 2 rem ailleurs). Une seule échelle ici.
 *
 * Le h1 reste en Bodoni Moda italic : c'est la signature éditoriale de la marque
 * (DESIGN.md §4), le seul endroit du back-office où elle s'exprime. Tout le reste
 * de l'écran est en Geist, dense et neutre.
 */
export function AdminPageHeader({
  title,
  description,
  eyebrow,
  actions,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  /** Sur-titre discret (contexte, période couverte…). */
  eyebrow?: ReactNode;
  /** Actions primaires, alignées à droite sur ≥ sm, empilées dessous sur mobile. */
  actions?: ReactNode;
  /** Contenu additionnel sous la description (chips d'alerte, filtres globaux…). */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('flex flex-col gap-4', className)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {eyebrow ? (
            <p className="mb-1.5 text-[0.6875rem] font-semibold tracking-[0.08em] text-[color:var(--color-muted-foreground)] uppercase">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="font-display text-[clamp(1.5rem,1.1rem+1.6vw,2rem)] leading-[1.15] tracking-[-0.022em] italic">
            {title}
          </h1>
          {description ? (
            <p className="mt-1.5 max-w-[68ch] text-sm text-[color:var(--color-muted-foreground)]">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">{actions}</div>
        ) : null}
      </div>
      {children}
    </header>
  );
}
