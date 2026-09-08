import type { ComponentType, ReactNode } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/cn';

/**
 * Tuile de KPI.
 *
 * Deux niveaux d'emphase — `hero` et `default` — parce que la vue d'ensemble
 * alignait huit tuiles rigoureusement identiques : tout y avait le même poids,
 * donc rien n'y était lisible en premier. Le revenu et le MRR passent en `hero`,
 * le reste en `default`.
 *
 * Le ton `critical` ne s'appuie pas seulement sur la couleur (une valeur rouge
 * seule n'est pas perceptible pour un daltonien) : il ajoute un liseré à gauche
 * et le libellé reste explicite.
 */

export type StatTone = 'default' | 'positive' | 'critical';

const TONE_VALUE: Record<StatTone, string> = {
  default: 'text-[color:var(--color-foreground)]',
  positive: 'text-[color:var(--color-foreground)]',
  critical: 'text-[color:var(--color-danger)]',
};

export function AdminStat({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'default',
  emphasis = 'default',
  delta,
  href,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ComponentType<{ className?: string; strokeWidth?: number; 'aria-hidden'?: boolean }>;
  tone?: StatTone;
  emphasis?: 'default' | 'hero';
  /** Variation relative signée (0.12 = +12 %). `up` n'est pas toujours bon : voir `deltaGood`. */
  delta?: { value: string; direction: 'up' | 'down' | 'flat'; good?: boolean; label?: string };
  /** Rend la tuile cliquable vers la section détaillée. */
  href?: string;
  className?: string;
}) {
  const hero = emphasis === 'hero';

  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[0.6875rem] font-semibold tracking-[0.08em] text-[color:var(--color-muted-foreground)] uppercase">
          {label}
        </p>
        {Icon ? (
          <Icon
            className="h-4 w-4 shrink-0 text-[color:var(--color-muted-foreground)]"
            strokeWidth={1.75}
            aria-hidden
          />
        ) : null}
      </div>

      <p
        className={cn(
          'mt-2.5 font-semibold tracking-[-0.02em] tabular-nums',
          hero
            ? 'text-[clamp(1.75rem,1.4rem+1.4vw,2.25rem)] leading-none'
            : 'text-2xl leading-none',
          TONE_VALUE[tone],
        )}
      >
        {value}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        {delta ? <StatDelta {...delta} /> : null}
        {hint ? (
          <span className="text-xs text-[color:var(--color-muted-foreground)]">{hint}</span>
        ) : null}
      </div>

      {href ? (
        <ArrowRight
          className="absolute right-4 bottom-4 h-4 w-4 text-[color:var(--color-muted-foreground)] opacity-0 transition-opacity group-hover/stat:opacity-100"
          strokeWidth={1.75}
          aria-hidden
        />
      ) : null}
    </>
  );

  const shell = cn(
    'group/stat relative flex flex-col rounded-xl border bg-[color:var(--color-surface)] p-4 text-left',
    'transition-colors duration-150',
    tone === 'critical'
      ? 'border-[color:var(--color-danger)]/35'
      : 'border-[color:var(--color-border)]',
    hero && 'sm:p-5',
    href && 'focus-ring hover:border-[color:var(--color-border-strong)]',
    className,
  );

  if (href) {
    return (
      <Link href={href as never} className={shell}>
        {body}
      </Link>
    );
  }

  return <div className={shell}>{body}</div>;
}

function StatDelta({
  value,
  direction,
  good,
  label,
}: NonNullable<Parameters<typeof AdminStat>[0]['delta']>) {
  // `good` dissocie le sens de la flèche de son jugement : un taux d'abandon
  // qui monte est une flèche haute et une mauvaise nouvelle.
  const positive = good ?? direction === 'up';
  const Icon =
    direction === 'up' ? ArrowUpRight : direction === 'down' ? ArrowDownRight : ArrowRight;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-medium tabular-nums',
        direction === 'flat'
          ? 'bg-[color:var(--color-surface-elevated)] text-[color:var(--color-muted-foreground)]'
          : positive
            ? 'bg-[color:var(--color-success-soft)] text-[color:color-mix(in_oklab,var(--color-success),var(--color-foreground)_42%)]'
            : 'bg-[color:var(--color-danger-soft)] text-[color:color-mix(in_oklab,var(--color-danger),var(--color-foreground)_40%)]',
      )}
    >
      <Icon className="h-3 w-3" strokeWidth={2.5} aria-hidden />
      {value}
      {label ? <span className="sr-only"> {label}</span> : null}
    </span>
  );
}

/** Grille de tuiles. `cols` borne la largeur max ; en dessous on retombe sur 2 puis 1. */
export function AdminStatGrid({
  children,
  cols = 4,
  className,
}: {
  children: ReactNode;
  cols?: 2 | 3 | 4;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-3 sm:grid-cols-2',
        cols === 3 && 'lg:grid-cols-3',
        cols === 4 && 'lg:grid-cols-4',
        className,
      )}
    >
      {children}
    </div>
  );
}
