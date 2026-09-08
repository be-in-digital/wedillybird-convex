import { cn } from '@/lib/cn';

/**
 * Légende de graphe, en HTML plutôt que via `<Legend>` de Recharts.
 *
 * Deux raisons. D'abord Recharts dérive la couleur d'une pastille du `stroke` de
 * la série : nos aplats empilés portent un liseré couleur *surface* (le séparateur
 * de 2 px), ce qui rendait la légende entière invisible — et `Legend` n'accepte
 * plus de `payload` explicite depuis la v3. Ensuite une légende HTML ne consomme
 * pas la hauteur du tracé et suit les tokens du thème sans style inline.
 */
export function ChartLegend({
  items,
  className,
}: {
  items: readonly { label: string; color: string }[];
  className?: string;
}) {
  return (
    <ul className={cn('mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5', className)}>
      {items.map((item) => (
        <li
          key={item.label}
          className="inline-flex items-center gap-1.5 text-xs text-[color:var(--color-muted-foreground)]"
        >
          <span
            aria-hidden
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: item.color }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
