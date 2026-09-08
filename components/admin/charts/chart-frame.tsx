'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { ResponsiveContainer } from 'recharts';
import { LineChart } from 'lucide-react';
import { AdminEmptyState } from '@/components/admin/ui/empty-state';

/**
 * Cadre commun des graphes : hauteur responsive et état vide unifié.
 *
 * Les graphes étaient figés à 280 px et rendaient un simple texte centré quand
 * la donnée manquait. On garde une hauteur fluide (`aspect` borné) pour que le
 * graphe respire sur grand écran sans écraser un téléphone.
 */
export function ChartFrame({
  isEmpty,
  emptyLabel,
  height = 280,
  children,
}: {
  isEmpty: boolean;
  emptyLabel?: string;
  height?: number;
  children: ReactNode;
}) {
  const t = useTranslations('Admin');

  if (isEmpty) {
    return <AdminEmptyState icon={LineChart} title={emptyLabel ?? t('charts.noData')} compact />;
  }

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        {children as React.ReactElement}
      </ResponsiveContainer>
    </div>
  );
}
