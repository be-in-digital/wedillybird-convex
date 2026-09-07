import type { MetadataRoute } from 'next';
import { routing } from '@/i18n/routing';

/**
 * Sitemap public — Next.js 16 file-based pattern, multilingue.
 *
 * Couvre uniquement les routes publiques indexables : landing, page pros,
 * forfaits pros, contact, FAQ, mentions légales. Les routes authentifiées (`/dashboard`,
 * `/pro/*`, `/onboarding`) et les routes personnelles à token (`/i/[token]`,
 * `/orgs/[slug]/event/*`) sont exclues — voir `app/robots.ts`.
 *
 * Chaque route est émise pour chaque locale, avec `alternates.languages`
 * pointant vers les autres traductions (cf. RFC hreflang). Le préfixe de
 * locale par défaut (`fr`) est omis (`localePrefix: 'as-needed'` dans
 * `i18n/routing.ts`).
 */
type RouteConfig = {
  path: string;
  priority: number;
  changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'];
};

const ROUTES: ReadonlyArray<RouteConfig> = [
  { path: '/', priority: 1.0, changeFrequency: 'weekly' },
  { path: '/pros', priority: 0.9, changeFrequency: 'monthly' },
  { path: '/forfaits-pros', priority: 0.8, changeFrequency: 'monthly' },
  { path: '/contact', priority: 0.7, changeFrequency: 'monthly' },
  { path: '/faq', priority: 0.6, changeFrequency: 'monthly' },
  { path: '/legal/terms', priority: 0.5, changeFrequency: 'yearly' },
  { path: '/legal/privacy', priority: 0.5, changeFrequency: 'yearly' },
  { path: '/legal/cookies', priority: 0.5, changeFrequency: 'yearly' },
  // Programme sur invitation, mais page publique et indexable : une créatrice
  // doit pouvoir lire les conditions AVANT d'accepter, sans compte.
  { path: '/legal/affiliation', priority: 0.4, changeFrequency: 'yearly' },
];

function localizedUrl(baseUrl: string, locale: string, path: string): string {
  const normalizedPath = path === '/' ? '' : path;
  if (locale === routing.defaultLocale) {
    return `${baseUrl}${normalizedPath || '/'}`;
  }
  return `${baseUrl}/${locale}${normalizedPath}`;
}

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://wedillybird.com';
  const lastModified = new Date();

  const entries: MetadataRoute.Sitemap = [];
  for (const route of ROUTES) {
    const languages = Object.fromEntries(
      routing.locales.map((l) => [l, localizedUrl(baseUrl, l, route.path)]),
    );
    for (const locale of routing.locales) {
      entries.push({
        url: localizedUrl(baseUrl, locale, route.path),
        lastModified,
        changeFrequency: route.changeFrequency,
        priority: route.priority,
        alternates: { languages },
      });
    }
  }
  return entries;
}
