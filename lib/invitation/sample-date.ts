/**
 * Date de mariage d'ÉCHANTILLON pour les démos de la landing (cinématique du
 * chapitre 04, bento des univers, page `/demo`). Fixe (pas de `Date.now()` →
 * aucun mismatch d'hydratation) et dans le futur pour que le compte à rebours
 * reste positif — à repousser d'un an chaque été. Formatée PAR PAYS via
 * `Intl.DateTimeFormat(locale)` — « 12 juin 2027 » en France, « June 12, 2027 »
 * aux États-Unis — exactement comme la vraie page d'invitation
 * (`app/[locale]/i/[token]/page.tsx`).
 */
export const SAMPLE_EVENT_DATE_ISO = '2027-06-12T14:00:00Z';

const SAMPLE_EVENT_DATE = new Date(SAMPLE_EVENT_DATE_ISO);

/** Format compact localisé (jour mois année, capitales) de la date démo. */
export function formatSampleDate(locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
    .format(SAMPLE_EVENT_DATE)
    .toUpperCase();
}
