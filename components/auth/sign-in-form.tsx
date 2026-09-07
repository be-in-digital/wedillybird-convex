'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { PhoneInput } from '@/components/auth/phone-input';
import { requestOtpAction } from '@/app/[locale]/(auth)/actions';
import { translateZodMessage } from '@/lib/validators/translate-zod';

function mapError(code: string, t: (k: string) => string): string {
  switch (code) {
    case 'INVALID_INPUT':
      return t('errors.invalidPhone');
    case 'RATE_LIMITED':
      return t('errors.rateLimited');
    // Suspension administrative : message explicite plutôt qu'« une erreur est
    // survenue » — sans quoi la personne réessaie indéfiniment.
    case 'ACCOUNT_SUSPENDED':
      return t('errors.accountSuspended');
    default:
      return t('errors.unknown');
  }
}

export function SignInForm({ next = null }: { next?: string | null }) {
  const t = useTranslations('Auth');
  const tRoot = useTranslations();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[] | undefined>>({});

  function handleSubmit(formData: FormData) {
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = await requestOtpAction(formData);
      if (result.ok) {
        const phone = result.phone ?? '';
        router.push({
          pathname: '/verify',
          // `next` voyage avec le numero : sans lui, la partenaire perd son
          // lien d'invitation entre la demande de code et la verification.
          query: next ? { phone, next } : { phone },
        });
        return;
      }
      setError(mapError(result.error, t));
      if (result.fieldErrors) setFieldErrors(result.fieldErrors);
    });
  }

  const phoneError = translateZodMessage(fieldErrors.phone?.[0], (k) => tRoot(k as never));

  return (
    <form action={handleSubmit} className="flex flex-col gap-5" noValidate>
      <div className="flex flex-col gap-2">
        <Label htmlFor="phone">{t('phoneLabel')}</Label>
        <PhoneInput
          id="phone"
          name="phone"
          autoFocus
          required
          error={phoneError}
          aria-describedby={error ? 'auth-error' : undefined}
        />
      </div>

      {error ? (
        <p id="auth-error" role="alert" className="text-sm text-[color:var(--color-destructive)]">
          {error}
        </p>
      ) : null}

      <Button type="submit" size="lg" disabled={pending}>
        {pending ? t('sending') : t('sendCode')}
      </Button>

      <p className="text-xs leading-relaxed text-[color:var(--color-muted)]">{t('smsConsent')}</p>
    </form>
  );
}
