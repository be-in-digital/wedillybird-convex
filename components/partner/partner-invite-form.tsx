'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { redeemPartnerInviteAction } from '@/app/[locale]/(app)/pro/actions';

interface Props {
  token: string;
  defaultName: string;
  months: number;
}

/**
 * Un seul champ : le nom de l'agence. Tout le reste (forfait, durée, code
 * partenaire) est déjà décidé par le lien — le demander à nouveau ne ferait
 * qu'ajouter des occasions d'abandonner.
 */
export function PartnerInviteForm({ token, defaultName, months }: Props) {
  const t = useTranslations('PartnerInvite');
  const tCommon = useTranslations('Common');
  const router = useRouter();
  const [name, setName] = useState(defaultName);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError(t('errors.invalid_name'));
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await redeemPartnerInviteAction(token, trimmed);
      if (result.ok) {
        router.push('/pro/dashboard');
        router.refresh();
        return;
      }
      // Les erreurs du serveur sont des codes stables (`INVITE_EXPIRED`,
      // `ORG_ALREADY_SUBSCRIBED`…). Une clé manquante ne doit pas casser la
      // page : on retombe sur un message générique.
      const key = result.error.toLowerCase();
      const known = [
        'unauthorized',
        'invite_not_found',
        'invite_expired',
        'invite_revoked',
        'invite_consumed',
        'org_already_subscribed',
        'invalid_name',
        'user_not_found',
      ];
      setError(
        known.includes(key) ? t(`errors.${key}` as 'errors.unauthorized') : t('errors.unknown'),
      );
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" data-testid="partner-invite-form">
      <div className="flex flex-col gap-2">
        <Label htmlFor="partner-org-name">{t('nameLabel')}</Label>
        <Input
          id="partner-org-name"
          name="organizationName"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('namePlaceholder')}
          maxLength={120}
          autoFocus
          required
          data-testid="partner-org-name"
        />
        <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('nameHelp')}</p>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-[color:var(--color-destructive)]">
          {error}
        </p>
      ) : null}

      <Button type="submit" disabled={pending} data-testid="partner-invite-submit">
        {pending ? tCommon('loading') : t('submit', { months })}
      </Button>
    </form>
  );
}
