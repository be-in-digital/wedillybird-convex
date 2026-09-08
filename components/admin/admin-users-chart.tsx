'use client';

import { useTranslations } from 'next-intl';
import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';
import { AXIS_PROPS, CHART_SURFACE, GRID_PROPS, SERIES, TOOLTIP_PROPS } from './charts/chart-theme';
import { ChartFrame } from './charts/chart-frame';
import { ChartLegend } from './charts/chart-legend';

type MonthData = { couple: number; pro: number; guest: number };

/** Ordre fixe des séries : la teinte suit le rôle, jamais son rang dans les données. */
const ROLES = [
  { key: 'couple', color: SERIES.brand, labelKey: 'charts.couples' },
  { key: 'pro', color: SERIES.blue, labelKey: 'charts.pros' },
  { key: 'guest', color: SERIES.gold, labelKey: 'charts.guests' },
] as const;

/**
 * Nouveaux comptes par mois, empilés par rôle.
 *
 * Trois séries → légende obligatoire : l'identité ne doit jamais reposer sur la
 * seule couleur. Les aplats sont séparés par un liseré de 2 px couleur surface,
 * qui sert aussi d'encodage secondaire pour la paire or↔rose (WARN daltonien).
 * Ce liseré interdit la légende de Recharts (elle en dérive ses pastilles, donc
 * les rendait couleur surface, donc invisibles) : voir `ChartLegend`.
 */
export function AdminUsersChart({ data }: { data: Record<string, MonthData> }) {
  const t = useTranslations('Admin');

  const chartData = Object.entries(data)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, counts]) => ({ month: month.slice(2), ...counts }));

  return (
    <>
      <ChartFrame isEmpty={chartData.length === 0} height={252}>
        <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
          <CartesianGrid {...GRID_PROPS} />
          <XAxis dataKey="month" {...AXIS_PROPS} />
          <YAxis {...AXIS_PROPS} width={40} allowDecimals={false} />
          <Tooltip {...TOOLTIP_PROPS} cursor={{ stroke: 'var(--color-border-strong)' }} />
          {ROLES.map((role) => (
            <Area
              key={role.key}
              type="monotone"
              dataKey={role.key}
              stackId="1"
              stroke={CHART_SURFACE}
              strokeWidth={2}
              fill={role.color}
              fillOpacity={0.75}
              name={t(role.labelKey)}
            />
          ))}
        </AreaChart>
      </ChartFrame>
      {chartData.length > 0 ? (
        <ChartLegend items={ROLES.map((r) => ({ label: t(r.labelKey), color: r.color }))} />
      ) : null}
    </>
  );
}
