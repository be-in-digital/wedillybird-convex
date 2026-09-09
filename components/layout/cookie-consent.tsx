'use client';

import { useTranslations } from 'next-intl';
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { CONSENT_STORAGE_KEY, setAnalyticsConsent } from '@/lib/analytics/posthog-client';

/**
 * CookieConsent — bandeau de consentement RGPD.
 *
 * Conforme aux lignes directrices CNIL :
 * - les finalités sont nommées (mesure d'audience PostHog, pixel publicitaire
 *   Meta) — pas de « aucun traceur » alors que l'acceptation en charge deux ;
 * - « Continuer sans accepter » est au même niveau visuel qu'« Accepter » ;
 * - lien vers la politique de cookies ; le choix est réversible.
 *
 * Forme : une barre compacte collée en bas de l'écran, sur toute la largeur.
 * L'ancienne carte flottante (420 px, bas-gauche) recouvrait le sous-titre du
 * hero et, sur mobile, la moitié de l'écran (audit sept. 2026). La barre reste
 * sous le contenu utile : le CTA du hero est visible au-dessus.
 *
 * Pilote PostHog + pixel Meta : tant que l'utilisateur n'a pas accepté, rien
 * n'est capturé ni déposé. Le choix est propagé immédiatement via
 * `setAnalyticsConsent` — pas de reload.
 */
export function CookieConsent() {
  const t = useTranslations('CookieConsent');
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Délai pour une apparition plus fluide (ne pas bloquer le LCP)
    const timer = setTimeout(() => {
      let consent: string | null = null;
      try {
        consent = localStorage.getItem(CONSENT_STORAGE_KEY);
      } catch {
        /* stockage indisponible (navigation privée stricte) : on affiche */
      }
      if (!consent) {
        setShow(true);
      }
    }, 1500);
    return () => clearTimeout(timer);
  }, []);

  const persist = (value: 'accepted' | 'declined') => {
    try {
      localStorage.setItem(CONSENT_STORAGE_KEY, value);
    } catch {
      /* no-op : le choix vaut pour la session courante */
    }
  };

  const handleAccept = () => {
    persist('accepted');
    setAnalyticsConsent(true);
    setShow(false);
  };

  const handleDecline = () => {
    persist('declined');
    setAnalyticsConsent(false);
    setShow(false);
  };

  if (!show) return null;

  return (
    <div
      role="region"
      aria-label={t('title')}
      className="animate-in slide-in-from-bottom-4 fade-in fixed inset-x-0 bottom-0 z-[100] border-t border-[color:var(--color-border)] bg-white/95 shadow-[0_-8px_30px_-12px_rgba(0,0,0,0.18)] backdrop-blur duration-400 supports-[backdrop-filter]:bg-white/85"
    >
      <div className="container-page flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:gap-6 sm:py-3.5">
        <p className="flex-1 text-[13px] leading-snug text-[color:var(--color-ink-700)]">
          <span className="font-semibold text-[color:var(--color-ink-900)]">{t('title')}</span>
          <span aria-hidden> — </span>
          {t('bodyBefore')}
          <Link
            href="/legal/cookies"
            className="font-medium text-[color:var(--color-ink-900)] underline underline-offset-2 transition-colors hover:text-[color:var(--color-blush-700)]"
          >
            {t('policyLink')}
          </Link>
          {t('bodyAfter')}
        </p>
        <div className="flex shrink-0 flex-row-reverse items-center gap-2 sm:flex-row">
          <Button
            onClick={handleDecline}
            variant="outline"
            size="sm"
            className="flex-1 sm:flex-none"
          >
            {t('decline')}
          </Button>
          <Button
            onClick={handleAccept}
            variant="primary"
            size="sm"
            className="flex-1 sm:flex-none"
          >
            {t('accept')}
          </Button>
        </div>
      </div>
    </div>
  );
}
