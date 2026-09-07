import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { compDaysRemaining } from '@/lib/payments/comped-trial';

/**
 * Décompte du compte offert.
 *
 * Un cadeau posé en interne n'a aucun abonnement Stripe derrière : rien ne
 * viendra prélever, donc rien ne préviendra non plus. Sans cette bannière, une
 * partenaire découvrirait la fin de ses six mois le jour où le back-office se
 * referme. Elle reste discrète et ne se met en avant que dans le dernier mois —
 * un décompte insistant dès le premier jour transforme un cadeau en compte à
 * rebours anxiogène.
 */
export async function CompedTrialBanner({
  expiresAt,
  now,
}: {
  expiresAt: number;
  /**
   * Instant de référence, fourni par l'appelant. Lire l'horloge dans le corps
   * du composant serait un appel impur pendant le rendu — et rendrait le
   * décompte intestable.
   */
  now: number;
}) {
  const days = compDaysRemaining({ expiresAt }, now);
  if (days <= 0) return null;

  const t = await getTranslations('Pro');
  const urgent = days <= 30;

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-sm ${
        urgent
          ? 'border-[color:var(--color-gold-700)] bg-[color:var(--color-surface-elevated)]'
          : 'border-[color:var(--color-border)] bg-[color:var(--color-surface)]'
      }`}
      data-testid="comped-trial-banner"
    >
      <p className="text-[color:var(--color-foreground)]">
        {days === 1 ? t('compedTrialTomorrow') : t('compedTrialRemaining', { days })}
      </p>
      <Link
        href="/pro/billing"
        className="font-mono text-[10px] tracking-[0.2em] text-[color:var(--color-gold-700)] uppercase underline underline-offset-4"
      >
        {t('compedTrialCta')}
      </Link>
    </div>
  );
}
