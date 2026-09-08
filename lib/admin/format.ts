/**
 * Formatage partagé du back-office admin.
 *
 * `CURRENCY_DIVISOR` vivait en double dans `admin-payments-table` et
 * `admin-invoices-table` — deux copies d'une table dont une erreur (XOF est
 * zéro-décimale, TND en millimes) afficherait un montant faux de deux ordres de
 * grandeur. Une seule source ici.
 */

const CURRENCY_DIVISOR: Record<string, number> = {
  EUR: 100,
  USD: 100,
  GBP: 100,
  CAD: 100,
  CHF: 100,
  XOF: 1,
  MAD: 100,
  TND: 1000,
};

/** Nombre d'unités mineures dans une unité majeure (100 pour EUR, 1 pour XOF…). */
export function currencyDivisor(currency: string): number {
  return CURRENCY_DIVISOR[currency] ?? 100;
}

/**
 * Montant en unité mineure → chaîne localisée (« 1 234,56 € »).
 *
 * Le nombre de décimales est celui de la devise, décidé par `Intl` : 2 pour
 * l'euro, 0 pour le franc CFA, 3 pour le dinar. On forçait `minimumFractionDigits: 0`,
 * ce qui affichait « 17,7 € » dans un tableau de commissions là où une ligne
 * comptable s'écrit « 17,70 € » — et alignait mal les colonnes de montants.
 */
export function formatMoneyMinor(amountMinor: number, currency: string, locale = 'fr-FR'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  }).format(amountMinor / currencyDivisor(currency));
}

/** Montant EUR en centimes → « 12 340 € » (arrondi, pour les KPI). */
export function formatEurCompact(amountMinor: number, locale = 'fr-FR'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amountMinor / 100);
}

/** Entier lisible (« 12 480 »). */
export function formatCount(value: number, locale = 'fr-FR'): string {
  return new Intl.NumberFormat(locale).format(value);
}

/** Ratio 0–1 → « 12,4 % ». */
export function formatRatio(value: number, locale = 'fr-FR', digits = 1): string {
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatDate(ts: number, locale = 'fr-FR'): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(ts));
}

export function formatDateTime(ts: number, locale = 'fr-FR'): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(ts),
  );
}

/**
 * Date relative courte (« il y a 3 j »). Utilisée dans les colonnes « dernière
 * activité » où la date absolue n'apporte rien et coûte de la largeur.
 */
export function formatRelative(ts: number, locale = 'fr-FR', now = Date.now()): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
  const diffSec = Math.round((ts - now) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(diffSec, 'second');
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  if (abs < 2_592_000) return rtf.format(Math.round(diffSec / 86_400), 'day');
  if (abs < 31_536_000) return rtf.format(Math.round(diffSec / 2_592_000), 'month');
  return rtf.format(Math.round(diffSec / 31_536_000), 'year');
}

/** Initiales pour un avatar (« Marie Dupont » → « MD »), repli sur « ? ». */
export function initialsOf(name?: string | null, fallback?: string | null): string {
  const source = (name ?? fallback ?? '').trim();
  if (!source) return '?';
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return (parts[0]![0]! + (parts[1]?.[0] ?? '')).toUpperCase();
}
