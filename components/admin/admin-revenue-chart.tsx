'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';
import { formatEurCompact } from '@/lib/admin/format';
import { AXIS_PROPS, GRID_PROPS, SERIES, TOOLTIP_PROPS, compactNumber } from './charts/chart-theme';
import { ChartFrame } from './charts/chart-frame';

/** Revenu encaissé par mois. Une seule série → pas de légende, le titre suffit. */
export function AdminRevenueChart({ data }: { data: Record<string, number> }) {
  const t = useTranslations('Admin');
  const locale = useLocale();

  const chartData = Object.entries(data)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, amountMinor]) => ({ month: month.slice(2), revenue: amountMinor / 100 }));

  return (
    <ChartFrame isEmpty={chartData.length === 0}>
      <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -8 }}>
        <CartesianGrid {...GRID_PROPS} />
        <XAxis dataKey="month" {...AXIS_PROPS} />
        <YAxis {...AXIS_PROPS} width={48} tickFormatter={(v: number) => compactNumber(v, locale)} />
        <Tooltip
          {...TOOLTIP_PROPS}
          formatter={(value) => [
            formatEurCompact(Number(value) * 100, locale),
            t('charts.revenue'),
          ]}
        />
        {/* Coins arrondis côté valeur seulement : la base reste ancrée à l'axe. */}
        <Bar dataKey="revenue" fill={SERIES.brand} radius={[4, 4, 0, 0]} maxBarSize={44} />
      </BarChart>
    </ChartFrame>
  );
}
