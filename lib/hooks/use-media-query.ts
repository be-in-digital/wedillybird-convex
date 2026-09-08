'use client';

import { useEffect, useState } from 'react';

/**
 * Media query réactive, SSR-safe. Rend `false` au premier paint côté serveur puis
 * se synchronise dans un effet — on ne peut pas connaître la largeur au SSR, donc
 * les appelants doivent traiter `false` comme « pas encore su », jamais comme
 * « desktop ». C'est pourquoi le shell admin rend sa sidebar en CSS (md:flex) et
 * ne se sert de ce hook que pour choisir *où* monter la navigation (tiroir vs rail).
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/** Breakpoint `md` de Tailwind (48rem = 768px). */
export function useIsMobile(): boolean {
  return !useMediaQuery('(min-width: 768px)');
}
