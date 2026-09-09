'use client';

import { motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { inViewOnce, scrollReveal, scrollRevealParent } from '@/lib/motion/presets';

/**
 * Landing — Manifesto V5.
 *
 * Absorbe les anciennes sections Stats + Comparison en un seul chapitre
 * éditorial qui raconte le « pourquoi » de Wedillybird :
 *
 * 1. Lede long-format Migra italic (la conviction)
 * 2. Diptyque "Hier / Désormais" en prose éditoriale (pas un tableau)
 * 3. Pull-quote géant climax (promesse B "Six mois après...")
 *
 * Les « trois stats » (98 % d'ouverture, 73 % de RSVP en 24 h…) et leur
 * mention « mesuré sur 1 240 mariages » ont été retirées (audit sept. 2026) :
 * aucune de ces valeurs n'a été mesurée sur de vrais mariages Wedillybird.
 * Elles reviendront le jour où elles sortiront du dashboard produit.
 *
 * Inspiration : Aesop product story + Atelier Isabey "atelier" page +
 * Mercury "Why Mercury" section éditoriale.
 *
 * Pattern : asymétrie volontaire (lede gauche large, diptyque pleine largeur,
 * pull-quote centré). Pas de bento, pas de cards.
 */
export function LandingManifesto() {
  const t = useTranslations('Landing.manifesto');

  return (
    <section className="paper-grain relative bg-[color:var(--color-ivory-50)] py-32 sm:py-40">
      <div className="container-page">
        {/* Eyebrow chapitre */}
        <motion.span
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={inViewOnce}
          className="mb-12 inline-block font-mono text-[11px] tracking-[0.32em] text-[color:var(--color-ink-500)] uppercase"
        >
          {t('chapter')}
        </motion.span>

        {/* Bloc 1 : Titre + lede */}
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={inViewOnce}
          variants={scrollRevealParent}
          className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20"
        >
          <motion.div variants={scrollReveal} className="flex flex-col">
            <span className="text-xs font-medium tracking-[0.24em] text-[color:var(--color-gold-700)] uppercase">
              {t('eyebrow')}
            </span>
            <h2
              className="font-display mt-5 text-balance italic"
              style={{
                fontSize: 'clamp(2.25rem, 5.5vw, 4rem)',
                lineHeight: 1.0,
                letterSpacing: '-0.025em',
                color: 'var(--color-ink-900)',
              }}
            >
              {t('title')}
            </h2>
          </motion.div>

          <motion.div variants={scrollReveal} className="flex flex-col gap-7 lg:pt-3">
            <p className="text-lg leading-relaxed text-[color:var(--color-ink-700)] sm:text-xl">
              {t('lede')}
            </p>
          </motion.div>
        </motion.div>

        {/* Diptyque Hier / Désormais — prose éditoriale, pas un tableau */}
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={inViewOnce}
          variants={scrollRevealParent}
          className="mt-28 grid gap-12 border-t border-[color:var(--color-border)] pt-16 lg:grid-cols-2 lg:gap-16"
        >
          <motion.div variants={scrollReveal} className="flex flex-col gap-5">
            <span className="font-mono text-[10px] tracking-[0.32em] text-[color:var(--color-ink-400)] uppercase">
              {t('before.label')}
            </span>
            <p className="text-base leading-relaxed text-[color:var(--color-ink-500)] sm:text-lg">
              {t('before.body')}
            </p>
          </motion.div>

          <motion.div
            variants={scrollReveal}
            className="flex flex-col gap-5 border-t border-[color:var(--color-blush-200)] pt-12 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-12"
          >
            <span className="font-mono text-[10px] tracking-[0.32em] text-[color:var(--color-blush-700)] uppercase">
              {t('after.label')}
            </span>
            <p className="text-base leading-relaxed text-[color:var(--color-ink-900)] sm:text-lg">
              {t('after.body')}
            </p>
          </motion.div>
        </motion.div>

        {/* Pull-quote climax — promesse "six mois après" */}
        <motion.figure
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0, transition: { duration: 0.7, ease: 'easeOut' } }}
          viewport={inViewOnce}
          className="mx-auto mt-32 max-w-4xl text-center"
        >
          <span
            aria-hidden
            className="font-display block text-6xl text-[color:var(--color-gold-500)] italic"
          >
            &ldquo;
          </span>
          <blockquote
            className="font-display mx-auto mt-2 text-balance italic"
            style={{
              fontSize: 'clamp(1.75rem, 4.5vw, 3rem)',
              lineHeight: 1.15,
              letterSpacing: '-0.022em',
              color: 'var(--color-ink-900)',
            }}
          >
            {t('pullquote')}
          </blockquote>
        </motion.figure>
      </div>
    </section>
  );
}
