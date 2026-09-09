'use client';

import Image from 'next/image';
import heroBg from './hero-bg.jpg';
import { motion, useReducedMotion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { ArrowRight } from 'lucide-react';
import { analytics } from '@/lib/analytics/posthog-client';
import { InvitationCard3D } from './invitation-card-3d';
import { MagneticCta } from './magnetic-cta';

/**
 * Landing — Hero V5.
 *
 * Composition éditoriale asymétrique inspirée Adovasio (SOTD wedding éditorial)
 * et Mercury (rigueur compositionnelle). Pas de téléphone — la figure héroïque
 * est une carte d'invitation 3D scannée qui slow-rotate au mouse-move.
 *
 * Layout :
 * - Photo hero plein cadre derrière, floutée + overlay ivoire 65 % pour
 *   garantir la lisibilité tout en posant l'émotion mariage
 * - Copy gauche : promesse concrète (« Vos invitations de mariage, envoyées
 *   sur WhatsApp. ») + sous-titre qui liste ce que fait le produit
 * - Carte d'invitation 3D droite, ratio 5:7, rotation suit le curseur
 * - Trust strip : garanties vraies (paiement unique, remboursement 7 j,
 *   données en Europe) — aucun chiffre de preuve sociale tant qu'il n'est pas
 *   mesuré sur de vrais mariages
 * - Magnetic CTA primary + canvas-confetti au hover ; CTA secondaire vers la
 *   démo publique `/demo`
 *
 * Contrainte d'audit (sept. 2026) : le CTA principal doit rester visible SANS
 * scroller à 1440×900 et 390×844, bannière cookies comprise — d'où les
 * espacements resserrés et l'absence d'eyebrow décoratif.
 */
export function LandingHero() {
  const t = useTranslations('Landing.hero');
  const reduced = useReducedMotion();

  const containerVariants = {
    hidden: {},
    visible: { transition: { staggerChildren: reduced ? 0 : 0.1, delayChildren: 0.1 } },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: reduced ? 0 : 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.7, ease: 'easeOut' as const } },
  };

  return (
    <section className="relative isolate min-h-[100svh] overflow-hidden">
      {/* Photo hero plein cadre — couple Provence golden hour, Unsplash regradé */}
      <div className="absolute inset-0 -z-20">
        <Image
          src={heroBg}
          alt=""
          fill
          priority
          quality={55}
          placeholder="blur"
          // Overlay ivoire ~70 % → la finesse est invisible : on sert une
          // variante plus légère sur mobile (gain de transfert = LCP).
          sizes="(max-width: 768px) 62vw, 100vw"
          className="object-cover"
        />
      </div>

      {/* Overlay ivoire 70 % pour garder l'émotion sans écraser la copy */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10"
        style={{
          background: [
            'radial-gradient(60% 50% at 12% 30%, oklch(98.5% 0.008 85 / 88%) 0%, oklch(98.5% 0.008 85 / 70%) 60%, transparent 100%)',
            'linear-gradient(135deg, oklch(98.5% 0.008 85 / 70%) 0%, oklch(95% 0.025 22 / 50%) 60%, oklch(92% 0.035 80 / 40%) 100%)',
          ].join(', '),
        }}
      />

      {/* Texture grain global */}
      <div aria-hidden className="paper-grain pointer-events-none absolute inset-0 -z-10" />

      <motion.div
        className="container-wide relative grid min-h-[calc(100svh-4.75rem)] items-center gap-12 py-8 lg:grid-cols-[1.15fr_0.85fr] lg:gap-12 lg:py-10"
        initial="hidden"
        animate="visible"
        variants={containerVariants}
      >
        {/* Copy column */}
        <div className="flex flex-col">
          <motion.h1
            variants={itemVariants}
            className="text-balance"
            style={{
              fontFamily: 'var(--font-sans)',
              fontWeight: 400,
              // Borné pour qu'un titre sur 4 lignes + sous-titre + CTA tiennent
              // dans un viewport laptop de 720 px de haut (cf. e2e landing).
              fontSize: 'clamp(2.25rem, 5vw, 4.25rem)',
              lineHeight: 0.96,
              letterSpacing: '-0.035em',
              color: 'var(--color-ink-900)',
            }}
          >
            {t('title')}
            <br />
            <span
              style={{
                fontFamily: 'var(--font-display)',
                fontStyle: 'italic',
                fontWeight: 400,
                color: 'var(--color-blush-700)',
                letterSpacing: '-0.025em',
              }}
            >
              {t('titleAccent')}
            </span>
          </motion.h1>

          <motion.p
            variants={itemVariants}
            className="mt-6 max-w-xl text-base leading-relaxed text-pretty text-[color:var(--color-ink-700)] sm:text-lg"
          >
            {t('subtitle')}
          </motion.p>

          <motion.div
            variants={itemVariants}
            className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center"
          >
            <MagneticCta
              href="/sign-up"
              variant="primary"
              size="xl"
              className="w-full justify-center sm:w-auto sm:min-w-60"
              wrapperClassName="block w-full sm:inline-block sm:w-auto"
              withConfetti
              onClick={() =>
                analytics.ctaClicked({ source: 'hero_primary', destination: '/sign-up' })
              }
            >
              {t('ctaPrimary')}
              <ArrowRight
                className="ml-1 h-4 w-4 transition-transform [@media(hover:hover)]:group-hover:translate-x-0.5"
                aria-hidden
              />
            </MagneticCta>
            <MagneticCta
              href="/demo"
              variant="outline"
              size="xl"
              className="w-full justify-center sm:w-auto sm:min-w-52"
              wrapperClassName="block w-full sm:inline-block sm:w-auto"
              onClick={() =>
                analytics.ctaClicked({ source: 'hero_secondary', destination: '/demo' })
              }
            >
              {t('ctaSecondary')}
            </MagneticCta>
          </motion.div>

          {/* Trust strip — garanties vérifiables, mono caps */}
          <motion.ul
            variants={itemVariants}
            className="mt-8 flex flex-wrap gap-x-6 gap-y-2 border-t border-[color:var(--color-border)] pt-5 font-mono text-[10px] font-semibold tracking-[0.24em] text-[color:var(--color-ink-700)] uppercase sm:mt-10 sm:gap-x-8 sm:pt-6"
          >
            {(['noSubscription', 'refund', 'dataEu'] as const).map((key) => (
              <li key={key} className="inline-flex items-center gap-2">
                <span
                  aria-hidden
                  className="inline-block h-1 w-1 rounded-full bg-[color:var(--color-gold-500)]"
                />
                {t(`trust.${key}`)}
              </li>
            ))}
          </motion.ul>
        </div>

        {/* Carte invitation 3D column — sous la copy sur mobile, donc jamais
            entre le titre et le CTA. */}
        <motion.div
          variants={itemVariants}
          className="flex items-center justify-center lg:justify-end"
        >
          <InvitationCard3D />
        </motion.div>
      </motion.div>

      {/* Scroll cue subtil */}
      <motion.div
        aria-hidden
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.4, duration: 0.8 }}
        className="absolute bottom-8 left-1/2 hidden -translate-x-1/2 lg:block"
      >
        <span className="font-mono text-[9px] tracking-[0.32em] text-[color:var(--color-ink-500)] uppercase">
          Scroll
        </span>
        <div className="mx-auto mt-2 h-10 w-px bg-gradient-to-b from-[color:var(--color-ink-500)] to-transparent" />
      </motion.div>
    </section>
  );
}
