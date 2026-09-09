import type { Locale } from '../i18n/routing';

/**
 * Catalogue pays partagé des champs téléphone — drapeau, indicatif et format
 * local attendu.
 *
 * Source unique : le sélecteur d'authentification (`components/auth/phone-input`)
 * et les champs du design system couple (`components/mon-mariage`) le lisent
 * tous les deux. Dupliquer cette liste, c'est garantir qu'un pays ajouté d'un
 * côté manquera de l'autre.
 */

export interface Country {
  code: string;
  dial: string;
  name: string;
  flag: string;
  /** Format typique d'un mobile local (sans indicatif), affiché en placeholder. */
  placeholder: string;
}

export const FR: Country = {
  code: 'FR',
  dial: '33',
  name: 'France',
  flag: '🇫🇷',
  placeholder: '6 12 34 56 78',
};

export const COUNTRIES: ReadonlyArray<Country> = [
  FR,
  { code: 'BE', dial: '32', name: 'Belgique', flag: '🇧🇪', placeholder: '470 12 34 56' },
  { code: 'CH', dial: '41', name: 'Suisse', flag: '🇨🇭', placeholder: '78 123 45 67' },
  { code: 'LU', dial: '352', name: 'Luxembourg', flag: '🇱🇺', placeholder: '621 123 456' },
  { code: 'GB', dial: '44', name: 'United Kingdom', flag: '🇬🇧', placeholder: '7700 900123' },
  { code: 'US', dial: '1', name: 'United States', flag: '🇺🇸', placeholder: '555 123 4567' },
  { code: 'CA', dial: '1', name: 'Canada', flag: '🇨🇦', placeholder: '416 555 0123' },
  { code: 'IE', dial: '353', name: 'Ireland', flag: '🇮🇪', placeholder: '85 123 4567' },
  { code: 'ES', dial: '34', name: 'España', flag: '🇪🇸', placeholder: '612 34 56 78' },
  { code: 'PT', dial: '351', name: 'Portugal', flag: '🇵🇹', placeholder: '912 345 678' },
  { code: 'BR', dial: '55', name: 'Brasil', flag: '🇧🇷', placeholder: '11 91234 5678' },
  { code: 'IT', dial: '39', name: 'Italia', flag: '🇮🇹', placeholder: '320 123 4567' },
  { code: 'DE', dial: '49', name: 'Deutschland', flag: '🇩🇪', placeholder: '151 23456789' },
  { code: 'AT', dial: '43', name: 'Österreich', flag: '🇦🇹', placeholder: '664 1234567' },
  { code: 'NL', dial: '31', name: 'Nederland', flag: '🇳🇱', placeholder: '6 12345678' },
  {
    code: 'SA',
    dial: '966',
    name: 'المملكة العربية السعودية',
    flag: '🇸🇦',
    placeholder: '51 234 5678',
  },
  { code: 'AE', dial: '971', name: 'الإمارات', flag: '🇦🇪', placeholder: '50 123 4567' },
  { code: 'EG', dial: '20', name: 'مصر', flag: '🇪🇬', placeholder: '100 123 4567' },
  { code: 'SN', dial: '221', name: 'Sénégal', flag: '🇸🇳', placeholder: '77 123 45 67' },
  { code: 'CI', dial: '225', name: "Côte d'Ivoire", flag: '🇨🇮', placeholder: '07 12 34 56 78' },
  { code: 'MA', dial: '212', name: 'Maroc', flag: '🇲🇦', placeholder: '6 12 34 56 78' },
  { code: 'DZ', dial: '213', name: 'Algérie', flag: '🇩🇿', placeholder: '5 51 23 45 67' },
  { code: 'TN', dial: '216', name: 'Tunisie', flag: '🇹🇳', placeholder: '20 123 456' },
  { code: 'CM', dial: '237', name: 'Cameroun', flag: '🇨🇲', placeholder: '6 71 23 45 67' },
  { code: 'ML', dial: '223', name: 'Mali', flag: '🇲🇱', placeholder: '76 12 34 56' },
  { code: 'CD', dial: '243', name: 'RD Congo', flag: '🇨🇩', placeholder: '81 234 5678' },
  { code: 'CG', dial: '242', name: 'Congo', flag: '🇨🇬', placeholder: '06 123 45 67' },
  { code: 'BF', dial: '226', name: 'Burkina Faso', flag: '🇧🇫', placeholder: '70 12 34 56' },
  { code: 'GN', dial: '224', name: 'Guinée', flag: '🇬🇳', placeholder: '6 21 23 45 67' },
  { code: 'TG', dial: '228', name: 'Togo', flag: '🇹🇬', placeholder: '90 12 34 56' },
  { code: 'BJ', dial: '229', name: 'Bénin', flag: '🇧🇯', placeholder: '90 12 34 56' },
  { code: 'NE', dial: '227', name: 'Niger', flag: '🇳🇪', placeholder: '93 12 34 56' },
  { code: 'GA', dial: '241', name: 'Gabon', flag: '🇬🇦', placeholder: '06 03 12 34' },
  { code: 'MG', dial: '261', name: 'Madagascar', flag: '🇲🇬', placeholder: '32 12 345 67' },
  { code: 'MU', dial: '230', name: 'Maurice', flag: '🇲🇺', placeholder: '5251 2345' },
  { code: 'HT', dial: '509', name: 'Haïti', flag: '🇭🇹', placeholder: '34 10 1234' },
];

export const LOCALE_TO_COUNTRY: Record<Locale, string> = {
  fr: 'FR',
  en: 'GB',
  es: 'ES',
  it: 'IT',
  pt: 'PT',
  de: 'DE',
  ar: 'SA',
};

/**
 * Nombre de chiffres attendus pour le numéro **local** d'un pays, déduit de son
 * placeholder (qui décrit le format réel : `77 123 45 67` → 9 chiffres).
 *
 * Dériver plutôt que ressaisir évite qu'un pays ajouté à la liste arrive sans
 * sa longueur, ou avec une longueur qui contredit son propre placeholder.
 */
export function expectedNationalDigits(country: Country): number {
  return country.placeholder.replace(/\D/g, '').length;
}

export type NationalNumberCheck = 'ok' | 'empty' | 'tooShort' | 'tooLong';

/**
 * Le numéro local a-t-il une longueur plausible pour ce pays ?
 *
 * Motivation : la validation E.164 générique n'accepte qu'une fourchette de 8 à
 * 15 chiffres *tous pays confondus*. Un `+221 471 12 62` (7 chiffres au lieu de
 * 9 au Sénégal) la franchit sans problème — puis le message WhatsApp part dans
 * le vide et l'utilisateur attend un code qui n'arrivera jamais. On veut le lui
 * dire avant l'envoi, pas après le silence.
 *
 * Tolérance de ±1 chiffre : certains pays ont des longueurs variables, et mieux
 * vaut laisser passer un cas limite que bloquer un numéro valide.
 */
export function checkNationalNumber(country: Country, local: string): NationalNumberCheck {
  const digits = local.replace(/\D/g, '');
  if (digits.length === 0) return 'empty';
  const expected = expectedNationalDigits(country);
  if (expected === 0) return 'ok';
  if (digits.length < expected - 1) return 'tooShort';
  if (digits.length > expected + 1) return 'tooLong';
  return 'ok';
}
