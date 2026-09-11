'use client';

import { Link } from '@/i18n/navigation';
import { buttonVariants, type ButtonProps } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { analytics } from '@/lib/analytics/posthog-client';
import type { AnalyticsAudience, BillingPeriod } from '@/lib/analytics/events';

/**
 * CTA d'en-tête extrait en client component.
 *
 * Les pages marketing (landing, pros) sont des server components ; on isole
 * juste le bouton sign-up ici pour pouvoir tracker le clic via PostHog sans
 * basculer toute la page en client. Rend le même `Link`+`Button` qu'avant.
 */
interface Props {
  /** Destination (peut inclure des query params, ex. `?plan=...`). */
  href: string;
  /** Libellé déjà traduit (le namespace i18n reste côté server component). */
  label: string;
  /** Identifiant de provenance pour l'event (`header`, `pros_header`…). */
  source: string;
  /** Classes du bouton (mêmes que l'inline d'origine). */
  className?: string;
  plan?: string;
  billing?: BillingPeriod;
  audience?: AnalyticsAudience;
  /** Valeur `destination` de l'event (par défaut `/sign-up`). */
  destination?: string;
  /**
   * Style du bouton. `primary` pour l'action d'acquisition (créer un compte),
   * `ghost` pour l'action secondaire de retour (se connecter) — un utilisateur
   * qui revient ne doit pas avoir à deviner, mais ne doit pas non plus se voir
   * proposer deux actions de même poids visuel.
   */
  variant?: ButtonProps['variant'];
}

export function HeaderCta({
  href,
  label,
  source,
  className,
  plan,
  billing,
  audience,
  destination = '/sign-up',
  variant = 'primary',
}: Props) {
  return (
    <Link
      href={href as never}
      onClick={() => analytics.ctaClicked({ source, destination, plan, billing, audience })}
      className={cn(
        buttonVariants({ variant, size: 'sm' }),
        // 44px de cible tactile sur mobile (barre sticky), compact ≥ md.
        'h-11 whitespace-nowrap md:h-9',
        className,
      )}
    >
      {label}
    </Link>
  );
}
