import createIntlMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing } from './i18n/routing';
import { extractOrgSlug, sharedCookieDomain } from './lib/subdomain/extract-org-slug';
import { currencyForCountry, detectCountryFromHeaders } from './lib/payments/country';

/**
 * Proxy Next 16 — gère deux responsabilités côté edge :
 *
 *  1. Rewrite multi-tenant : `<slug>.wedillybird.com/<path>` →
 *     `/orgs/<slug>/<path>` (transparent pour l'utilisateur, l'URL
 *     affichée reste le sous-domaine).
 *  2. Routing next-intl (locales fr/en/es/it/pt/de/ar, prefix `as-needed` —
 *     `fr` est servi sans préfixe, les autres sous `/<locale>/...`).
 *
 * En dev local (où on n'a pas de DNS wildcard), le param de querystring
 * `?orgPreview=<slug>` simule le sous-domaine — utile pour Playwright et
 * pour un test rapide en navigateur.
 *
 * Les sous-domaines système (`www`, `api`, `media`, `app`, `admin`) sont
 * whitelistés dans `lib/subdomain/extract-org-slug.ts` et ne sont jamais
 * rewrités. Les domaines preview Vercel (`*.vercel.app`) non plus.
 */

const intlMiddleware = createIntlMiddleware(routing);

const SLUG_PREVIEW_PARAM = 'orgPreview';
const SLUG_PREVIEW_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/i;

function isAlreadyOrgPath(pathname: string): boolean {
  // Évite la double-réécriture si une requête arrive déjà sur `/orgs/<slug>`
  // (pas censé arriver depuis l'extérieur, mais ceinture-bretelles).
  return /^\/(?:[a-z]{2}\/)?orgs\//.test(pathname);
}

function buildRewriteUrl(req: NextRequest, slug: string): URL {
  const url = req.nextUrl.clone();
  // Préserve le préfixe locale s'il est explicite (ex: `/fr/event/...`).
  // next-intl est en `as-needed` avec `fr` par défaut, donc la plupart
  // des URLs n'auront pas de préfixe de locale.
  const localeMatch = url.pathname.match(/^\/([a-z]{2})(\/|$)/);
  const matchedLocale = localeMatch?.[1];
  const localePrefix =
    matchedLocale && (routing.locales as readonly string[]).includes(matchedLocale)
      ? `/${matchedLocale}`
      : '';
  const rest = url.pathname.slice(localePrefix.length) || '/';
  url.pathname = `${localePrefix}/orgs/${slug}${rest === '/' ? '' : rest}`;
  return url;
}

function resolveOrgSlug(req: NextRequest): string | null {
  // 1. Sous-domaine prod : `<slug>.wedillybird.com`.
  const host = req.headers.get('host');
  const fromHost = extractOrgSlug(host);
  if (fromHost) return fromHost;

  // 2. Override dev / E2E : `?orgPreview=<slug>` (uniquement sur localhost).
  const normalizedHost = (host ?? '').toLowerCase();
  const isLocal =
    normalizedHost.startsWith('localhost') ||
    normalizedHost.startsWith('127.0.0.1') ||
    normalizedHost.endsWith('.localhost');
  if (!isLocal) return null;
  const preview = req.nextUrl.searchParams.get(SLUG_PREVIEW_PARAM);
  if (!preview) return null;
  if (!SLUG_PREVIEW_RE.test(preview)) return null;
  return preview.toLowerCase();
}

const AFFILIATE_REF_RE = /^[A-Za-z0-9]{3,24}$/;

export default function proxy(request: NextRequest) {
  // Attribution affiliation : premier `?ref=CODE` valide capté → cookie
  // first-party 30 j (httpOnly, lu côté serveur au checkout). Zéro friction.
  const rawRef = request.nextUrl.searchParams.get('ref');
  const ref = rawRef && AFFILIATE_REF_RE.test(rawRef) ? rawRef.toUpperCase() : null;

  const slug = resolveOrgSlug(request);
  const response =
    slug && !isAlreadyOrgPath(request.nextUrl.pathname)
      ? (() => {
          const rewriteUrl = buildRewriteUrl(request, slug);
          const res = NextResponse.rewrite(rewriteUrl);
          res.headers.set('x-org-slug', slug);
          return res;
        })()
      : intlMiddleware(request);

  // First-touch : on ne pose le cookie que s'il n'existe pas déjà (le premier
  // parrain qui amène le visiteur garde l'attribution — pas de vol en fin de
  // parcours par un second lien).
  if (ref && response && !request.cookies.get('wdb_ref')) {
    // `domain` sur l'apex : le lien d'une agence pointe son sous-domaine
    // (`sarah.wedillybird.com/...?ref=SARAH12`) alors que le checkout vit sur
    // l'apex. Sans domaine partagé, le cookie host-only n'était jamais renvoyé
    // à `/api/checkout` — attribution ET remise perdues sans aucun signal.
    const domain = sharedCookieDomain(request.headers.get('host'));
    response.cookies.set('wdb_ref', ref, {
      maxAge: 30 * 24 * 60 * 60,
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      ...(domain ? { domain } : {}),
    });
  }

  // Devise par défaut pilotée par la GÉOGRAPHIE (pays de facturation), pas par
  // la langue d'UI — cf. `.context/pricing-v2.md` § « Règle devise ». Le client
  // lit ce cookie comme défaut d'affichage (non httpOnly) ; le sélecteur footer
  // reste prioritaire (override explicite persisté en localStorage). On ne pose
  // le cookie que si Vercel fournit un signal géo (`x-vercel-ip-country`) —
  // sinon (dev/local) on laisse le fallback locale opérer côté client.
  const geoCountry = detectCountryFromHeaders(request.headers);
  if (response && geoCountry) {
    response.cookies.set('wbb_ccy', currencyForCountry(geoCountry), {
      maxAge: 30 * 24 * 60 * 60,
      httpOnly: false,
      sameSite: 'lax',
      path: '/',
    });
  }
  return response;
}

export const config = {
  // Exclut `opengraph-image` / `twitter-image` qui sont des routes Next.js
  // file convention (next/og). Sans ça, le middleware next-intl les redirige
  // vers /fr/opengraph-image qui n'existe pas → 404.
  //
  // `ingest` est exclu aussi : c'est le reverse proxy PostHog (cf. rewrites
  // dans next.config.ts). Sans cette exclusion, next-intl interprète `ingest`
  // comme une locale et renvoie 404 sur `/ingest/e/`, `/ingest/flags/`… →
  // capture analytics cassée en prod (les requêtes avec extension comme
  // `/ingest/static/array.js` passaient seulement grâce au filtre `.*\\..*`).
  matcher: [
    '/((?!api|trpc|_next|_vercel|convex|ingest|opengraph-image|twitter-image|sitemap\\.xml|robots\\.txt|.*\\..*).*)',
  ],
};
