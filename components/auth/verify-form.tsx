'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { OtpInput } from '@/components/auth/otp-input';
import { analytics } from '@/lib/analytics/posthog-client';
import { requestOtpAction, verifyOtpAction } from '@/app/[locale]/(auth)/actions';

interface VerifyFormProps {
  phone: string;
  /** Destination post-connexion deja validee par la page. */
  next?: string | null;
}

const RESEND_SECONDS = 30;

function mapError(code: string, t: (k: string) => string): string {
  switch (code) {
    case 'INVALID_INPUT':
      return t('errors.invalidCode');
    case 'OTP_INVALID':
      return t('errors.invalidCode');
    case 'OTP_EXPIRED':
      return t('errors.expired');
    case 'OTP_TOO_MANY_ATTEMPTS':
      return t('errors.tooManyAttempts');
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

export function VerifyForm({ phone, next = null }: VerifyFormProps) {
  const t = useTranslations('Auth');
  const router = useRouter();
  const formRef = useRef<HTMLFormElement | null>(null);
  const [pending, startTransition] = useTransition();
  const [resendPending, startResendTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [cooldown, setCooldown] = useState(RESEND_SECONDS);
  const [resent, setResent] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const submit = useCallback(
    (value: string) => {
      setError(null);
      const formData = new FormData();
      formData.set('phone', phone);
      formData.set('code', value);
      startTransition(async () => {
        const result = await verifyOtpAction(formData);
        if (result.ok) {
          // Nouveau compte (pas une reconnexion) créé via OTP WhatsApp →
          // signup_completed avant la redirection vers l'onboarding (no-op
          // sans consentement). On ne compte PAS les logins comme des signups.
          if (result.isNewUser) {
            analytics.signupCompleted({ method: 'whatsapp' });
          }
          // Retour sur la destination demandee — sans quoi une partenaire
          // venue de `/rejoindre/<token>` perd son invitation ici meme, et se
          // retrouvera a devoir choisir un forfait payant.
          router.push((next ?? '/onboarding') as never);
          return;
        }
        setError(mapError(result.error, t));
        setCode('');
      });
    },
    [phone, next, router, t],
  );

  function handleSubmit(formData: FormData) {
    const value = String(formData.get('code') ?? '');
    if (!/^\d{6}$/.test(value)) {
      setError(t('errors.invalidCode'));
      return;
    }
    submit(value);
  }

  function handleResend() {
    if (cooldown > 0 || resendPending) return;
    const formData = new FormData();
    formData.set('phone', phone);
    startResendTransition(async () => {
      const result = await requestOtpAction(formData);
      if (result.ok) {
        setResent(true);
        setCooldown(RESEND_SECONDS);
        setError(null);
      } else {
        setError(mapError(result.error, t));
      }
    });
  }

  return (
    <form ref={formRef} action={handleSubmit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor="code" className="sr-only">
          {t('codeLabel')}
        </Label>
        <OtpInput
          name="code"
          autoFocus
          error={error ?? undefined}
          onChange={setCode}
          onComplete={submit}
        />
      </div>

      <Button type="submit" size="lg" disabled={pending || code.length !== 6}>
        {pending ? t('verifying') : t('verifyCode')}
      </Button>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm">
        <button
          type="button"
          onClick={() => router.push('/sign-in')}
          className="text-[color:var(--color-muted)] underline-offset-4 hover:underline"
        >
          {t('changeNumber')}
        </button>
        <button
          type="button"
          onClick={handleResend}
          disabled={cooldown > 0 || resendPending}
          className="text-[color:var(--color-primary)] underline-offset-4 hover:underline disabled:pointer-events-none disabled:opacity-50"
        >
          {cooldown > 0 ? t('resendIn', { seconds: cooldown }) : t('resendCode')}
        </button>
      </div>

      {resent ? (
        <p role="status" className="text-xs text-[color:var(--color-accent)]">
          {t('sendCode')} ✓
        </p>
      ) : null}
    </form>
  );
}
