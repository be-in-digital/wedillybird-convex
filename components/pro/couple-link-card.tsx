'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Heart, UserPlus, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PhoneInput } from '@/components/auth/phone-input';
import { toast } from '@/components/ui/toast';
import { linkCoupleAction, unlinkCoupleAction } from '@/app/[locale]/(app)/pro/actions';

interface CoupleLink {
  userId: string;
  phone: string;
  invitedAt: number;
}

/**
 * Carte agence « Espace couple » : rattache le couple à ce mariage par téléphone. Le
 * couple accède alors à son propre espace (suivi, invités, paiements) en se connectant
 * avec ce numéro. Owner/admin (vérifié côté serveur).
 */
export function CoupleLinkCard({
  eventId,
  initialLinks,
}: {
  eventId: string;
  initialLinks: CoupleLink[];
}) {
  const t = useTranslations('Pro.main');
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function invite() {
    setError(null);
    start(async () => {
      const res = await linkCoupleAction(eventId, phone.trim());
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast.success(
        res.alreadyLinked ? t('coupleLink.toastAlreadyLinked') : t('coupleLink.toastInvited'),
      );
      setPhone('');
      router.refresh();
    });
  }

  function unlinkAll() {
    setError(null);
    start(async () => {
      const res = await unlinkCoupleAction(eventId);
      if (!res.ok) {
        setError(res.error ?? t('coupleLink.genericError'));
        return;
      }
      toast.success(t('coupleLink.toastUnlinked'));
      router.refresh();
    });
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-5">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl"
          style={{
            background: 'color-mix(in oklch, var(--color-blush-500) 16%, transparent)',
            color: 'var(--color-blush-300)',
          }}
        >
          <Heart className="h-5 w-5" strokeWidth={1.9} />
        </span>
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-lg text-[color:var(--color-foreground)] italic">
            {t('coupleLink.title')}
          </h2>
          <p className="max-w-prose text-sm text-[color:var(--color-muted-foreground)]">
            {t('coupleLink.description')}
          </p>
        </div>
      </div>

      {initialLinks.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface-elevated)] px-3.5 py-3">
          <div className="flex flex-col gap-0.5">
            <span className="font-mono text-[9px] tracking-[0.16em] text-[color:var(--color-muted-foreground)] uppercase">
              {t('coupleLink.linkedEyebrow')}
            </span>
            <span className="font-mono text-sm text-[color:var(--color-foreground)]">
              {initialLinks.map((l) => l.phone).join(', ')}
            </span>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={unlinkAll} disabled={pending}>
            {t('coupleLink.detach')}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-[color:var(--color-muted-foreground)]">
          {t('coupleLink.emptyLinked')}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {/* Sélecteur pays + numéro local : l'agence n'a pas à connaître
            l'indicatif du couple qu'elle rattache. */}
        <PhoneInput
          defaultValue={phone}
          onValueChange={setPhone}
          className="max-w-xs"
          aria-label={t('coupleLink.phoneAria')}
        />
        <Button
          type="button"
          variant="primary"
          size="md"
          onClick={invite}
          disabled={pending || !phone.trim()}
        >
          <UserPlus className="h-4 w-4" strokeWidth={2} aria-hidden />
          {pending ? t('coupleLink.sending') : t('coupleLink.inviteCta')}
        </Button>
      </div>

      {error ? (
        <p
          role="alert"
          className="flex items-center gap-2 text-sm text-[color:var(--color-danger)]"
        >
          <AlertTriangle className="h-4 w-4 flex-shrink-0" strokeWidth={2} aria-hidden />
          {error}
        </p>
      ) : null}
    </section>
  );
}
