'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/cn';
import { analytics } from '@/lib/analytics/posthog-client';

type SectionItem = {
  id: string;
  /** Clé i18n sous `Landing.sectionNav`. */
  key: string;
};

// Ordre = ordre d'apparition au scroll dans la page. Déroger à cet ordre fait
// sauter l'underline en arrière quand l'utilisateur scrolle, ce qui casse la
// perception de progression.
const ITEMS: readonly SectionItem[] = [
  { id: 'features', key: 'features' },
  { id: 'pricing', key: 'pricing' },
  { id: 'faq', key: 'faq' },
];

/**
 * Liens d'ancres avec indicateur de section active.
 *
 * Calcule la section active au scroll à partir d'un repère situé dans le
 * premier quart du viewport. C'est plus stable qu'un ratio d'intersection pour
 * les sections longues et pour la FAQ située près de la fin de page.
 */
export function SectionNav() {
  const t = useTranslations('Landing.sectionNav');
  const [activeId, setActiveId] = useState<string | null>(null);
  // Dernière section trackée : évite d'émettre `section_viewed` à chaque frame de
  // scroll — on ne l'émet qu'au changement de section active.
  const lastTrackedId = useRef<string | null>(null);

  useEffect(() => {
    const sections = ITEMS.map((item) => document.getElementById(item.id)).filter(
      (el): el is HTMLElement => el !== null,
    );
    if (sections.length === 0) return;

    let frame = 0;

    function updateActiveSection() {
      frame = 0;
      const scrollY = window.scrollY;
      let nextActiveId: string | null = null;

      // Fin de page : la dernière section est active même si son haut n'atteint
      // jamais le repère. La FAQ est en bas de page — s'il n'y a pas assez de
      // contenu en dessous, on ne peut pas la scroller jusqu'à la ligne (le scroll
      // est plafonné), donc le dernier lien de nav ne s'allumerait jamais.
      const atBottom = scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
      if (atBottom) {
        nextActiveId = sections[sections.length - 1]?.id ?? null;
      } else {
        const marker = scrollY + 96 + window.innerHeight * 0.25;
        for (const section of sections) {
          // Position absolue dans le document via getBoundingClientRect (fiable même
          // quand la section a un offsetParent positionné/transformé par Motion/GSAP).
          // `offsetTop` est relatif à l'offsetParent → faussait la détection de la FAQ.
          const top = section.getBoundingClientRect().top + scrollY;
          if (top <= marker) {
            nextActiveId = section.id;
          } else {
            break;
          }
        }
      }

      setActiveId(nextActiveId);

      // Instrumentation des fuites de scroll (F9/F1) : signal une fois par section.
      if (nextActiveId && nextActiveId !== lastTrackedId.current) {
        lastTrackedId.current = nextActiveId;
        analytics.sectionViewed({ id: nextActiveId });
      }
    }

    function requestUpdate() {
      if (frame) return;
      frame = window.requestAnimationFrame(updateActiveSection);
    }

    updateActiveSection();
    window.addEventListener('scroll', requestUpdate, { passive: true });
    window.addEventListener('resize', requestUpdate);
    window.addEventListener('hashchange', requestUpdate);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', requestUpdate);
      window.removeEventListener('resize', requestUpdate);
      window.removeEventListener('hashchange', requestUpdate);
    };
  }, []);

  return (
    <>
      {ITEMS.map((item) => {
        const isActive = activeId === item.id;
        return (
          <Link
            key={item.id}
            href={`/#${item.id}` as never}
            aria-current={isActive ? 'true' : undefined}
            onClick={() =>
              analytics.ctaClicked({
                source: 'nav',
                destination: `#${item.id}`,
                label: t(item.key),
              })
            }
            className={cn(
              'relative font-mono text-[10px] tracking-[0.24em] uppercase transition-colors',
              isActive
                ? 'text-[color:var(--color-ink-900)]'
                : 'text-[color:var(--color-ink-500)] hover:text-[color:var(--color-ink-900)]',
            )}
          >
            {t(item.key)}
            <span
              aria-hidden
              className={cn(
                'absolute -bottom-1.5 left-0 h-px bg-[color:var(--color-gold-500)] transition-[width,opacity] duration-300 ease-out',
                isActive ? 'w-full opacity-100' : 'w-0 opacity-0',
              )}
            />
          </Link>
        );
      })}
    </>
  );
}
