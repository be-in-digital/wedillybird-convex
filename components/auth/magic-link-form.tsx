'use client';

import { useState, useTransition } from 'react';
import { motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { Mail, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { requestMagicLinkAction } from '@/app/[locale]/(auth)/actions';
import { translateZodMessage } from '@/lib/validators/translate-zod';

function mapError(code: string, t: (k: string) => string): string {
  switch (code) {
    case 'INVALID_INPUT':
    case 'INVALID_EMAIL':
      return t('errors.invalidEmail');
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

/**
 * MagicLinkForm — fallback auth pour les utilisateurs sans WhatsApp.
 *
 * Pattern miroir du SignInForm OTP. Une fois l'email envoyé, on bascule
 * vers une vue "boîte mail à vérifier" (success state) avec une animation
 * de confirmation Motion. Pas de redirection — l'utilisateur revient sur
 * cette page après avoir cliqué dans son email.
 */
export function MagicLinkForm({ next = null }: { next?: string | null }) {
  const t = useTranslations('Auth');
  const tRoot = useTranslations();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[] | undefined>>({});
  const [sentTo, setSentTo] = useState<string | null>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      // Le lien recu par e-mail doit ramener la partenaire sur son invitation,
      // pas sur l'onboarding generique : `next` part avec la demande et sera
      // recolle a l'URL de verification.
      if (next) formData.set('next', next);
      const result = await requestMagicLinkAction(formData);
      if (result.ok) {
        setSentTo(result.email ?? '');
        return;
      }
      setError(mapError(result.error, t));
      if (result.fieldErrors) setFieldErrors(result.fieldErrors);
    });
  }

  if (sentTo) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0, transition: { duration: 0.45, ease: 'easeOut' } }}
        className="flex flex-col items-center gap-5 rounded-2xl border border-[color:var(--color-blush-200)] bg-[color:var(--color-blush-50)] px-6 py-8 text-center"
      >
        <motion.span
          initial={{ scale: 0, rotate: -90 }}
          animate={{
            scale: 1,
            rotate: 0,
            transition: { type: 'spring', stiffness: 240, damping: 18 },
          }}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-[color:var(--color-blush-700)] shadow-[var(--shadow-soft)]"
          aria-hidden
        >
          <Mail className="h-6 w-6" strokeWidth={1.75} />
        </motion.span>
        <div className="flex flex-col gap-2">
          <p className="font-mono text-[10px] tracking-[0.32em] text-[color:var(--color-blush-700)] uppercase">
            {t('magicLinkSentEyebrow')}
          </p>
          <p
            className="font-display text-balance italic"
            style={{
              fontSize: 'clamp(1.25rem, 2.2vw, 1.5rem)',
              lineHeight: 1.2,
              letterSpacing: '-0.018em',
              color: 'var(--color-ink-900)',
            }}
          >
            {t('magicLinkSentTitle', { email: sentTo })}
          </p>
          <p className="text-sm leading-relaxed text-[color:var(--color-ink-500)]">
            {t('magicLinkSentDescription', { email: sentTo })}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setSentTo(null)}
          className="font-mono text-[10px] tracking-[0.24em] text-[color:var(--color-ink-500)] uppercase transition-colors hover:text-[color:var(--color-blush-700)]"
        >
          ← {t('magicLinkChangeEmail')}
        </button>
      </motion.div>
    );
  }

  const emailError = translateZodMessage(fieldErrors.email?.[0], (k) => tRoot(k as never));

  return (
    <form action={handleSubmit} className="flex flex-col gap-5" noValidate>
      <div className="flex flex-col gap-2">
        <Label htmlFor="magic-email">{t('emailLabel')}</Label>
        <Input
          id="magic-email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          autoFocus
          placeholder={t('emailPlaceholder')}
          required
          aria-invalid={!!emailError}
          aria-describedby={error ? 'magic-error' : undefined}
        />
        {emailError ? (
          <p className="text-xs text-[color:var(--color-destructive)]">{emailError}</p>
        ) : null}
      </div>

      {error ? (
        <p id="magic-error" role="alert" className="text-sm text-[color:var(--color-destructive)]">
          {error}
        </p>
      ) : null}

      <Button type="submit" size="lg" disabled={pending}>
        {pending ? (
          t('magicLinkSending')
        ) : (
          <>
            <CheckCircle2 className="h-4 w-4" strokeWidth={2} aria-hidden />
            {t('magicLinkSendCta')}
          </>
        )}
      </Button>
    </form>
  );
}
