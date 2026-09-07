'use client';

import { forwardRef, useEffect, useState, type InputHTMLAttributes } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { splitE164 } from '@/lib/phone';
import {
  checkNationalNumber,
  COUNTRIES,
  FR,
  LOCALE_TO_COUNTRY,
  type Country,
} from '@/lib/phone-countries';
import type { Locale } from '@/i18n/routing';

const DIAL_CODES = COUNTRIES.map((c) => c.dial);

interface PhoneInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'name' | 'defaultValue'
> {
  name?: string;
  error?: string;
  defaultCountry?: string;
  /** Numéro E.164 initial (édition) — pré-remplit l'indicatif + le local. */
  defaultValue?: string;
  /** Notifié à chaque changement du numéro complet E.164 (ou '' si vide). */
  onValueChange?: (value: string) => void;
}

export const PhoneInput = forwardRef<HTMLInputElement, PhoneInputProps>(
  (
    {
      className,
      error,
      id = 'phone',
      name = 'phone',
      defaultCountry,
      defaultValue,
      onValueChange,
      ...props
    },
    ref,
  ) => {
    const locale = useLocale() as Locale;
    const t = useTranslations('Auth');
    const parts = defaultValue ? splitE164(defaultValue, DIAL_CODES) : null;
    const fallbackCode = defaultCountry ?? LOCALE_TO_COUNTRY[locale] ?? FR.code;
    const initialCountry = parts
      ? (COUNTRIES.find((c) => c.dial === parts.dial) ?? FR)
      : (COUNTRIES.find((c) => c.code === fallbackCode) ?? FR);
    const [country, setCountry] = useState<Country>(initialCountry);
    const [local, setLocal] = useState(parts?.local ?? '');

    const sanitizedLocal = local.replace(/[^\d]/g, '').replace(/^0+/, '');

    // Longueur nationale : un numéro trop court passe la validation E.164
    // générique puis se perd à l'envoi. On le signale ici, avant que
    // l'utilisateur attende un code qui n'arrivera pas.
    const lengthCheck = checkNationalNumber(country, sanitizedLocal);
    const lengthError =
      lengthCheck === 'tooShort' || lengthCheck === 'tooLong'
        ? t('phoneLengthHint', { format: country.placeholder })
        : undefined;
    const shownError = error ?? lengthError;
    const describedBy = shownError ? `${id}-error` : undefined;

    // Un numéro de longueur invraisemblable ne sort pas du composant : les
    // appelants désactivent leur bouton sur une valeur vide, donc rien
    // d'indélivrable ne part.
    const fullPhone =
      sanitizedLocal && lengthCheck === 'ok' ? `+${country.dial}${sanitizedLocal}` : '';

    useEffect(() => {
      onValueChange?.(fullPhone);
    }, [fullPhone, onValueChange]);

    function handleChange(value: string) {
      const trimmed = value.trimStart();
      if (trimmed.startsWith('+')) {
        const digits = trimmed.slice(1).replace(/[^\d]/g, '');
        const match = [...COUNTRIES]
          .sort((a, b) => b.dial.length - a.dial.length)
          .find((c) => digits.startsWith(c.dial));
        if (match) {
          setCountry(match);
          setLocal(digits.slice(match.dial.length));
          return;
        }
      }
      setLocal(value);
    }

    return (
      <div className="flex flex-col gap-1.5">
        <div
          className={cn(
            'flex h-11 items-center rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] focus-within:ring-2 focus-within:ring-[color:var(--color-primary)]/40',
            shownError ? 'border-[color:var(--color-destructive)]' : '',
          )}
        >
          <Select
            value={country.code}
            onValueChange={(code) => {
              const next = COUNTRIES.find((c) => c.code === code);
              if (next) setCountry(next);
            }}
          >
            <SelectTrigger
              aria-label={t('countryCodeLabel')}
              className="h-full w-auto gap-1 rounded-l-lg rounded-r-none border-0 border-r border-[color:var(--color-border)] bg-transparent pr-2 pl-3 hover:border-[color:var(--color-border)]"
            >
              <span aria-hidden className="text-base leading-none">
                {country.flag}
              </span>
              <span className="text-sm text-[color:var(--color-muted)]">+{country.dial}</span>
            </SelectTrigger>
            <SelectContent>
              {COUNTRIES.map((c) => (
                <SelectItem key={c.code} value={c.code}>
                  {c.flag} {c.name} (+{c.dial})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <input
            ref={ref}
            id={id}
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            aria-invalid={!!shownError}
            aria-describedby={describedBy}
            value={local}
            onChange={(e) => handleChange(e.target.value)}
            className={cn(
              'h-full w-full bg-transparent px-3 text-sm outline-none placeholder:text-[color:var(--color-muted)]',
              className,
            )}
            placeholder={country.placeholder}
            {...props}
          />
          <input type="hidden" name={name} value={fullPhone} />
        </div>
        {shownError ? (
          <p id={describedBy} className="text-xs text-[color:var(--color-destructive)]">
            {shownError}
          </p>
        ) : null}
      </div>
    );
  },
);
PhoneInput.displayName = 'PhoneInput';
