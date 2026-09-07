'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { MessageCircle, Mail } from 'lucide-react';
import { cn } from '@/lib/cn';
import { analytics } from '@/lib/analytics/posthog-client';
import { SignInForm } from './sign-in-form';
import { MagicLinkForm } from './magic-link-form';

type Method = 'whatsapp' | 'email';

/**
 * AuthMethodSwitcher — toggle entre SignInForm OTP WhatsApp (par défaut)
 * et MagicLinkForm email (fallback pour ceux qui n'ont pas WhatsApp).
 *
 * Pattern visuel : 2 boutons radio en haut, contenu animé en dessous.
 * Animation Motion niveau B sobre (cross-fade rapide entre les forms).
 *
 * `intent` distingue le même formulaire selon sa page hôte : `signup` (page
 * /sign-up, cible des CTA marketing) déclenche l'analytics d'entrée de tunnel,
 * `signin` (par défaut, page /sign-in) reste silencieux. `plan`/`billing` sont
 * lus côté serveur depuis la query (props) pour ne pas forcer un bailout CSR
 * (useSearchParams) sur la page /sign-in qui partage ce composant.
 */
export function AuthMethodSwitcher({
  intent = 'signin',
  plan,
  billing,
  next = null,
}: {
  intent?: 'signin' | 'signup';
  plan?: string;
  billing?: 'monthly' | 'annual';
  /** Destination post-connexion, deja validee cote serveur. */
  next?: string | null;
}) {
  const t = useTranslations('Auth');
  const reduced = useReducedMotion();
  const [method, setMethod] = useState<Method>('whatsapp');

  // Entrée dans le tunnel d'inscription : un seul `signup_started` au montage,
  // côté /sign-up uniquement. La méthode par défaut est WhatsApp ; plan/billing
  // sont propagés depuis les liens pricing. No-op sans consentement (cf.
  // posthog-client).
  const startedRef = useRef(false);
  useEffect(() => {
    if (intent !== 'signup' || startedRef.current) return;
    startedRef.current = true;
    analytics.signupStarted({ method, ...(plan ? { plan } : {}), ...(billing ? { billing } : {}) });
    // Montage unique : pas de dépendances pour éviter tout double envoi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-7">
      {/* Toggle methods */}
      <div
        role="tablist"
        aria-label={t('methodSwitcherLabel')}
        className="grid grid-cols-2 gap-2 rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-ivory-100)] p-1.5"
      >
        <MethodButton
          method="whatsapp"
          active={method === 'whatsapp'}
          onClick={() => setMethod('whatsapp')}
          Icon={MessageCircle}
          label={t('methodWhatsapp')}
        />
        <MethodButton
          method="email"
          active={method === 'email'}
          onClick={() => setMethod('email')}
          Icon={Mail}
          label={t('methodEmail')}
        />
      </div>

      {/* Form animé selon la méthode sélectionnée */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={method}
          initial={{ opacity: 0, y: reduced ? 0 : 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: reduced ? 0 : -8 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          role="tabpanel"
        >
          {method === 'whatsapp' ? <SignInForm next={next} /> : <MagicLinkForm next={next} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

interface MethodButtonProps {
  method: Method;
  active: boolean;
  onClick: () => void;
  Icon: typeof MessageCircle;
  label: string;
}

function MethodButton({ method, active, onClick, Icon, label }: MethodButtonProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={`auth-panel-${method}`}
      onClick={onClick}
      className={cn(
        'focus-ring relative flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium transition-colors',
        active
          ? 'text-[color:var(--color-ink-900)]'
          : 'text-[color:var(--color-ink-500)] hover:text-[color:var(--color-ink-700)]',
      )}
    >
      {active && (
        <motion.span
          aria-hidden
          layoutId="auth-method-active"
          className="absolute inset-0 rounded-xl bg-white shadow-[var(--shadow-soft)]"
          transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        />
      )}
      <span className="relative flex items-center gap-2">
        <Icon className="h-4 w-4" strokeWidth={1.75} aria-hidden />
        {label}
      </span>
    </button>
  );
}
