'use client';

import { useLocale, useTranslations } from 'next-intl';
import { PieChart } from 'lucide-react';
import { formatEurCompact, formatRatio } from '@/lib/admin/format';
import { AdminEmptyState } from './ui/empty-state';

/**
 * Répartition d'un montant par clé (devise, provider…).
 *
 * Remplace les deux donuts de la vue d'ensemble. Un camembert est le mauvais
 * outil ici : il fait comparer des angles, il exigeait une légende **et** des
 * étiquettes de pourcentage redondantes, et il descendait à deux parts pour la
 * répartition par provider — un camembert à deux parts n'apprend rien qu'une
 * phrase ne dise mieux. Des barres horizontales triées répondent aux deux
 * questions réelles (« qui domine ? », « combien exactement ? »), n'ont besoin
 * que d'une teinte, et tiennent sur un téléphone.
 */
export function AdminBreakdown({
  data,
  emptyLabel,
}: {
  /** Montants en unité mineure EUR, indexés par clé. */
  data: Record<string, number>;
  emptyLabel?: string;
}) {
  const t = useTranslations('Admin');
  const locale = useLocale();

  const entries = Object.entries(data)
    .filter(([, amount]) => amount > 0)
    .sort(([, a], [, b]) => b - a);
  const total = entries.reduce((sum, [, amount]) => sum + amount, 0);

  if (entries.length === 0 || total === 0) {
    return <AdminEmptyState icon={PieChart} title={emptyLabel ?? t('charts.noData')} compact />;
  }

  return (
    <ul className="flex flex-col gap-3.5">
      {entries.map(([key, amount]) => {
        const share = amount / total;
        return (
          <li key={key} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-sm font-medium">{key}</span>
              <span className="shrink-0 font-mono text-sm tabular-nums">
                {formatEurCompact(amount, locale)}
                <span className="ml-2 text-xs text-[color:var(--color-muted-foreground)]">
                  {formatRatio(share, locale, 0)}
                </span>
              </span>
            </div>
            <div
              role="img"
              aria-label={`${key} : ${formatRatio(share, locale, 0)}`}
              className="h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--color-surface-elevated)]"
            >
              <div
                className="h-full rounded-full bg-[color:var(--color-primary)] transition-[width] duration-500 ease-[var(--ease-out-quint)]"
                style={{ width: `${Math.max(share * 100, 1.5)}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
