/**
 * Réglages partagés des graphes du back-office (thème dark uniquement — le
 * super admin ne rend jamais en light, cf. DESIGN.md §2).
 *
 * Les quatre graphes portaient chacun leur propre `contentStyle` de tooltip et
 * leurs propres couleurs en dur : quatre copies à faire diverger. Une seule ici.
 *
 * ## Palette catégorielle
 *
 * `SERIES` est validé (scripts de la méthode data-viz) sur la surface réelle du
 * back-office (`--color-surface` dark = #1a1110), en **toutes paires** :
 * bande de luminance OK, plancher de chroma OK, séparation daltonienne et
 * vision normale OK, contraste ≥ 3:1 OK. La paire or↔rose est en zone WARN
 * daltonienne (ΔE 7,5) : elle n'est donc utilisée **que** dans des graphes qui
 * portent une légende ET un séparateur de 2 px entre aplats — l'encodage
 * secondaire exigé. Ne pas ajouter de 4ᵉ série sans revalider.
 */

export const SERIES = {
  /** Rose de marque — série principale, revenus. */
  brand: '#d55759',
  /** Bleu — 2ᵉ série. */
  blue: '#2b7ec9',
  /** Or champagne — 3ᵉ série. */
  gold: '#be8700',
} as const;

/** Ordre fixe des séries catégorielles. Jamais cyclé : au-delà de 3, on facette. */
export const SERIES_ORDER = [SERIES.brand, SERIES.blue, SERIES.gold] as const;

/** Surface du graphe — sert de liseré de 2 px entre aplats empilés. */
export const CHART_SURFACE = 'var(--color-surface)';

export const AXIS_PROPS = {
  stroke: 'var(--color-muted-foreground)',
  fontSize: 11,
  tickLine: false as const,
  axisLine: false as const,
};

/** Grille horizontale seule : les verticales n'aident pas à lire une hauteur. */
export const GRID_PROPS = {
  stroke: 'var(--color-border)',
  strokeDasharray: '2 4',
  vertical: false as const,
};

export const TOOLTIP_PROPS = {
  cursor: { fill: 'var(--color-surface-elevated)', opacity: 0.35 },
  contentStyle: {
    background: 'var(--color-surface-elevated)',
    border: '1px solid var(--color-border-strong)',
    borderRadius: '0.75rem',
    boxShadow: 'var(--shadow-popover)',
    color: 'var(--color-foreground)',
    fontSize: 12,
    padding: '0.5rem 0.75rem',
  },
  labelStyle: { color: 'var(--color-muted-foreground)', marginBottom: 2 },
  itemStyle: { color: 'var(--color-foreground)', padding: 0 },
} as const;

/** « 12 480 » → « 12,5 k ». Un axe Y d'euros non compacté déborde vite en dark dense. */
export function compactNumber(value: number, locale = 'fr-FR'): string {
  return new Intl.NumberFormat(locale, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}
