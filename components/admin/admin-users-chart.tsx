'use client';

import { useTranslations } from 'next-intl';
import { Area, AreaChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from 'recharts';
import {
  AXIS_PROPS,
  CHART_SURFACE,
  GRID_PROPS,
  LEGEND_PROPS,
  SERIES,
  TOOLTIP_PROPS,
} from './charts/chart-theme';
import { ChartFrame } from './charts/chart-frame';

type MonthData = { couple: number; pro: number; guest: number };

/**
 * Nouveaux comptes par mois, empilés par rôle.
 *
 * Trois séries → légende obligatoire : l'identité ne doit jamais reposer sur la
 * seule couleur. Les aplats sont séparés par un liseré de 2 px couleur surface,
 * qui sert aussi d'encodage secondaire pour la paire or↔rose (WARN daltonien).
 */
export function AdminUsersChart({ data }: { data: Record<string, MonthData> }) {
  const t = useTranslations('Admin');

  const chartData = Object.entries(data)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, counts]) => ({ month: month.slice(2), ...counts }));

  return (
    <ChartFrame isEmpty={chartData.length === 0}>
      <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
        <CartesianGrid {...GRID_PROPS} />
        <XAxis dataKey="month" {...AXIS_PROPS} />
        <YAxis {...AXIS_PROPS} width={40} allowDecimals={false} />
        <Tooltip {...TOOLTIP_PROPS} cursor={{ stroke: 'var(--color-border-strong)' }} />
        <Legend {...LEGEND_PROPS} />
        <Area
          type="monotone"
          dataKey="couple"
          stackId="1"
          stroke={CHART_SURFACE}
          strokeWidth={2}
          fill={SERIES.brand}
          fillOpacity={0.85}
          name={t('charts.couples')}
        />
        <Area
          type="monotone"
          dataKey="pro"
          stackId="1"
          stroke={CHART_SURFACE}
          strokeWidth={2}
          fill={SERIES.blue}
          fillOpacity={0.85}
          name={t('charts.pros')}
        />
        <Area
          type="monotone"
          dataKey="guest"
          stackId="1"
          stroke={CHART_SURFACE}
          strokeWidth={2}
          fill={SERIES.gold}
          fillOpacity={0.85}
          name={t('charts.guests')}
        />
      </AreaChart>
    </ChartFrame>
  );
}
