'use client';

import { motion, useMotionValue, useSpring, useTransform } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';

/**
 * Carte d'invitation 3D — figure centrale du Hero V4.
 *
 * Pattern Awwwards 2026 (Aesop product page, Atelier Isabey) : objet papier
 * scanné en haute déf qui slow-rotate au mouse-move, donne du volume sans
 * tomber dans le mockup phone cliché.
 *
 * Composé en SVG pur : carte ivoire + filet gold + typographie Fraunces +
 * timbre postal au coin + sceau de cire blush. Accent texture papier via
 * filter feTurbulence.
 *
 * Interaction :
 * - mouse-tilt : rotateX/Y suit le curseur dans une plage ±8° desktop
 * - drift idle : oscillation lente Y±4° quand le curseur est hors zone
 * - whileHover : élévation subtile +shadow blush
 */
export function InvitationCard3D() {
  const t = useTranslations('Landing.hero.card');
  const ref = useRef<HTMLDivElement>(null);

  // Motion values pour le tilt — spring pour fluidité naturelle.
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const tiltX = useSpring(useTransform(mouseY, [-1, 1], [8, -8]), {
    stiffness: 80,
    damping: 14,
    mass: 0.6,
  });
  const tiltY = useSpring(useTransform(mouseX, [-1, 1], [-10, 10]), {
    stiffness: 80,
    damping: 14,
    mass: 0.6,
  });

  useEffect(() => {
    if (!ref.current) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;

    const el = ref.current;
    function handleMove(e: MouseEvent) {
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const range = Math.max(rect.width, rect.height) * 0.9;
      mouseX.set(((e.clientX - cx) / range) * 2);
      mouseY.set(((e.clientY - cy) / range) * 2);
    }
    function handleLeave() {
      mouseX.set(0);
      mouseY.set(0);
    }
    window.addEventListener('mousemove', handleMove);
    el.addEventListener('mouseleave', handleLeave);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      el.removeEventListener('mouseleave', handleLeave);
    };
  }, [mouseX, mouseY]);

  return (
    <div
      ref={ref}
      className="relative mx-auto w-full"
      style={{
        perspective: '1400px',
        // 28rem max, mais jamais plus haut que le viewport moins l'en-tête et
        // les marges (ratio 5:7) : sur un laptop 1280×720, une carte de 627 px
        // repoussait le CTA du hero sous la ligne de flottaison.
        maxWidth: 'min(28rem, calc((100svh - 14rem) * 0.714))',
      }}
    >
      {/* Halo blush flou derrière la carte */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 scale-110 rounded-[3rem] blur-3xl"
        style={{
          background:
            'radial-gradient(50% 50% at 50% 50%, oklch(85% 0.06 22 / 50%) 0%, transparent 70%)',
        }}
      />

      <motion.div
        style={{
          rotateX: tiltX,
          rotateY: tiltY,
          transformStyle: 'preserve-3d',
        }}
        className="relative aspect-[5/7] w-full"
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
      >
        {/* Carte papier — face avant */}
        <div
          className="absolute inset-0 overflow-hidden"
          style={{
            background:
              'linear-gradient(155deg, oklch(98% 0.012 25) 0%, oklch(95% 0.025 22) 60%, oklch(92% 0.035 80) 100%)',
            border: '1px solid oklch(88% 0.05 80)',
            borderRadius: '6px',
            boxShadow:
              '0 30px 80px -20px oklch(48% 0.085 22 / 25%), 0 0 0 1px oklch(91% 0.045 22), inset 0 1px 0 rgba(255,255,255,0.7)',
          }}
        >
          {/* Texture grain papier */}
          <svg
            aria-hidden
            className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.07] mix-blend-multiply"
          >
            <filter id="paper-grain-card">
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.85"
                numOctaves="2"
                stitchTiles="stitch"
              />
            </filter>
            <rect width="100%" height="100%" filter="url(#paper-grain-card)" />
          </svg>

          {/* Filet ornemental gold haut */}
          <div
            aria-hidden
            className="absolute top-7 right-7 left-7 h-px"
            style={{
              background:
                'linear-gradient(to right, transparent, oklch(78% 0.075 78) 20%, oklch(78% 0.075 78) 80%, transparent)',
            }}
          />

          {/* Eyebrow label */}
          <p className="absolute top-10 right-7 left-7 text-center font-mono text-[10px] tracking-[0.28em] text-[color:var(--color-ink-500)] uppercase">
            {t('label')}
          </p>

          {/* Couple — Fraunces géant centré */}
          <div className="absolute inset-x-7 top-[28%] flex flex-col items-center text-center">
            <span
              className="font-display tracking-tight text-balance italic"
              style={{
                fontSize: 'clamp(2rem, 5vw, 3rem)',
                lineHeight: 0.95,
                letterSpacing: '-0.022em',
                color: 'var(--color-ink-900)',
              }}
            >
              {t('couple')}
            </span>
            <span
              aria-hidden
              className="my-5 inline-block h-px w-12"
              style={{ background: 'oklch(78% 0.075 78)' }}
            />
            <span className="font-mono text-[10px] tracking-[0.32em] text-[color:var(--color-ink-700)] uppercase">
              {t('venue')}
            </span>
          </div>

          {/* Sceau de cire blush — bas de la carte */}
          <div className="absolute bottom-12 left-1/2 -translate-x-1/2">
            <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden>
              <defs>
                <radialGradient id="seal-blush" cx="50%" cy="40%" r="55%">
                  <stop offset="0%" stopColor="oklch(82% 0.085 22)" />
                  <stop offset="60%" stopColor="oklch(62% 0.095 20)" />
                  <stop offset="100%" stopColor="oklch(48% 0.085 22)" />
                </radialGradient>
                <filter id="seal-shadow">
                  <feGaussianBlur stdDeviation="1.2" />
                </filter>
              </defs>
              {/* Halo cire dispersée */}
              <path
                d="M 28 6 L 34 14 L 46 12 L 44 24 L 52 30 L 44 36 L 46 48 L 34 46 L 28 52 L 22 46 L 10 48 L 12 36 L 4 30 L 12 24 L 10 12 L 22 14 Z"
                fill="url(#seal-blush)"
                filter="url(#seal-shadow)"
                opacity="0.95"
              />
              {/* Initiale W gravée */}
              <text
                x="28"
                y="34"
                textAnchor="middle"
                fontFamily="var(--font-display)"
                fontStyle="italic"
                fontWeight="500"
                fontSize="20"
                fill="oklch(28% 0.05 26)"
                opacity="0.85"
              >
                W
              </text>
            </svg>
          </div>

          {/* RSVP hint en bas */}
          <p className="absolute right-7 bottom-6 left-7 text-center font-mono text-[9px] tracking-[0.32em] text-[color:var(--color-ink-400)] uppercase">
            {t('rsvpHint')}
          </p>

          {/* Timbre postal coin haut-droit */}
          <div className="absolute top-3 right-3 flex h-12 w-12 items-center justify-center">
            <div
              className="flex h-full w-full items-center justify-center rounded-sm"
              style={{
                background: 'oklch(95% 0.025 22)',
                border: '1px dashed oklch(78% 0.075 78)',
                transform: 'rotate(4deg)',
              }}
            >
              <span
                className="font-display text-xs italic"
                style={{ color: 'var(--color-blush-700)' }}
              >
                ♥
              </span>
            </div>
          </div>
        </div>

        {/* Petite ombre projetée sous la carte (3D) */}
        <div
          aria-hidden
          className="absolute inset-x-8 -bottom-3 h-6 rounded-full blur-md"
          style={{
            background: 'oklch(48% 0.085 22 / 20%)',
            transform: 'translateZ(-40px)',
          }}
        />
      </motion.div>
    </div>
  );
}
