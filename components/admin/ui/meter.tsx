import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Jauge « part d'un total » : libellé, valeur, part, barre.
 *
 * Les tons reprennent les couleurs de **statut** du design system (succès /
 * attention / danger / neutre) et rien d'autre — elles sont réservées à cet
 * usage, jamais recyclées en « série n° 4 » d'un graphe. Les anciennes barres
 * portaient des `oklch(...)` en dur qui ne suivaient pas le thème.
 */

export type MeterTone = 'brand' | 'success' | 'warning' | 'danger' | 'neutral';

const TONE_BAR: Record<MeterTone, string> = {
  brand: 'bg-[color:var(--color-primary)]',
  success: 'bg-[color:var(--color-success)]',
  warning: 'bg-[color:var(--color-warning)]',
  danger: 'bg-[color:var(--color-danger)]',
  neutral: 'bg-[color:var(--color-border-strong)]',
};

export function AdminMeter({
  label,
  value,
  total,
  tone = 'brand',
  valueLabel,
  size = 'sm',
  className,
}: {
  label: ReactNode;
  value: number;
  total: number;
  tone?: MeterTone;
  /** Remplace l'affichage brut de `value` (montant formaté, durée…). */
  valueLabel?: ReactNode;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const share = total > 0 ? value / total : 0;
  const pct = Math.round(share * 100);

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="min-w-0 truncate text-[color:var(--color-muted-foreground)]">{label}</span>
        <span className="shrink-0 font-mono tabular-nums">
          {valueLabel ?? value}
          {total > 0 ? (
            <span className="ml-1.5 text-[color:var(--color-muted-foreground)]">{pct} %</span>
          ) : null}
        </span>
      </div>
      <div
        role="img"
        aria-label={`${typeof label === 'string' ? label : ''} : ${pct} %`}
        className={cn(
          'overflow-hidden rounded-full bg-[color:var(--color-surface-elevated)]',
          size === 'md' ? 'h-2.5' : 'h-1.5',
        )}
      >
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-500 ease-[var(--ease-out-quint)]',
            TONE_BAR[tone],
          )}
          // Une part non nulle mais minuscule doit rester visible : sinon
          // « 1 sur 4 000 » se lit comme zéro.
          style={{ width: `${value > 0 ? Math.max(share * 100, 1.5) : 0}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Entonnoir de conversion : chaque étape est rapportée au **maximum** pour la
 * largeur, et à l'étape précédente pour le taux affiché — c'est ce taux-là qui
 * dit où l'on perd du monde.
 */
export function AdminFunnel({ steps }: { steps: readonly { label: string; value: number }[] }) {
  const max = Math.max(...steps.map((s) => s.value), 1);

  return (
    <ol className="flex flex-col gap-3.5">
      {steps.map((step, index) => {
        const previous = index > 0 ? steps[index - 1]!.value : null;
        const conversion = previous && previous > 0 ? (step.value / previous) * 100 : null;
        return (
          <li key={step.label} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate font-medium">{step.label}</span>
              <span className="flex shrink-0 items-baseline gap-2">
                <span className="font-mono tabular-nums">{step.value}</span>
                {conversion != null ? (
                  <span className="font-mono text-[0.6875rem] text-[color:var(--color-muted-foreground)] tabular-nums">
                    {conversion.toFixed(0)} %
                  </span>
                ) : null}
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-[color:var(--color-surface-elevated)]">
              <div
                className="h-full rounded-full bg-[color:var(--color-primary)] transition-[width] duration-500 ease-[var(--ease-out-quint)]"
                style={{ width: `${Math.max((step.value / max) * 100, 2)}%` }}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
