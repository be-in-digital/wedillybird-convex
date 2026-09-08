'use client';

import { useLocale } from 'next-intl';
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';
import { formatCount } from '@/lib/admin/format';
import { AXIS_PROPS, GRID_PROPS, SERIES, TOOLTIP_PROPS } from './charts/chart-theme';
import { ChartFrame } from './charts/chart-frame';

/**
 * Graphe à barres générique pour des **effectifs** (events, signups, par mois ou
 * par jour de semaine). Contrairement à `AdminRevenueChart`, ne divise pas par
 * 100 — les valeurs sont des comptes bruts. L'ordre des barres suit l'ordre du
 * tableau `data` fourni (le caller trie).
 *
 * Une seule série : `color` reste dans la palette validée (`SERIES`), on ne
 * passe pas une teinte arbitraire.
 */
export function AdminCountChart({
  data,
  color = SERIES.brand,
  unit = '',
}: {
  data: { label: string; value: number }[];
  color?: string;
  unit?: string;
}) {
  const locale = useLocale();
  const isEmpty = data.length === 0 || data.every((d) => d.value === 0);

  return (
    <ChartFrame isEmpty={isEmpty} height={260}>
      <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
        <CartesianGrid {...GRID_PROPS} />
        <XAxis dataKey="label" {...AXIS_PROPS} />
        <YAxis {...AXIS_PROPS} width={40} allowDecimals={false} />
        <Tooltip
          {...TOOLTIP_PROPS}
          formatter={(value) => [
            `${formatCount(Number(value), locale)}${unit ? ` ${unit}` : ''}`,
            '',
          ]}
        />
        <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} maxBarSize={44} />
      </BarChart>
    </ChartFrame>
  );
}
