/**
 * Extraction du slug d'organisation à partir du host HTTP entrant.
 *
 * Multi-tenant pattern : les pros Wedillybird disposent d'un sous-domaine
 * propre (`<slug>.wedillybird.com`) sur lequel on sert leurs événements
 * publics avec leur branding (logo + couleurs) plutôt que la marque
 * Wedillybird par défaut.
 *
 * Cette fonction est pure et testable : aucune I/O, aucun side effect.
 * Le proxy Next (`proxy.ts`) l'appelle avec le `host` de la requête et
 * fait un rewrite vers `/orgs/<slug>/...` quand un slug est détecté.
 *
 * Règles :
 * - Le port (`:3000`) est strippé avant analyse.
 * - Sur `localhost` (avec ou sans sous-domaine), aucun slug n'est extrait
 *   du host — l'override se fait via le param `?orgPreview=<slug>` géré
 *   par le proxy lui-même.
 * - Les sous-domaines système (`www`, `api`, `app`, `admin`, `media`) ne
 *   matchent pas comme slug d'orga — ils sont réservés à l'infra.
 * - Les domaines preview Vercel (`*.vercel.app`) ne matchent pas non plus
 *   pour éviter les false positives sur les URLs deploy preview
 *   (ex: `wedillybird-git-feat-xxx.vercel.app`).
 */

const ROOT_DOMAINS = ['wedillybird.com'] as const;

const RESERVED_SUBDOMAINS = new Set([
  'www',
  'api',
  'app',
  'admin',
  'media',
  'cdn',
  'mail',
  'static',
  'assets',
]);

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/i;

/**
 * Strip port suffix (`:3000`) and lowercase. Returns `null` for empty
 * input.
 */
function normalizeHost(host: string | null | undefined): string | null {
  if (!host) return null;
  const trimmed = host.trim().toLowerCase();
  if (!trimmed) return null;
  const idx = trimmed.indexOf(':');
  return idx === -1 ? trimmed : trimmed.slice(0, idx);
}

/**
 * Extrait le slug d'organisation à partir du host. Retourne `null` si :
 *  - Le host est invalide / vide.
 *  - Le host est un domaine racine (`wedillybird.com`, `localhost`).
 *  - Le sous-domaine est réservé à l'infra (whitelist).
 *  - Le host est un preview Vercel (`*.vercel.app`).
 *  - Le slug ne respecte pas le pattern (`[a-z0-9-]{1,40}`).
 *
 * @example
 * extractOrgSlug('tuum.wedillybird.com')          // → 'tuum'
 * extractOrgSlug('TUUM.WEDILLYBIRD.COM:443')      // → 'tuum'
 * extractOrgSlug('www.wedillybird.com')           // → null (réservé)
 * extractOrgSlug('media.wedillybird.com')         // → null (CDN CloudFront)
 * extractOrgSlug('wedillybird.com')               // → null (racine)
 * extractOrgSlug('localhost:3000')                // → null
 * extractOrgSlug('tuum.localhost:3000')           // → null (dev: utiliser ?orgPreview=)
 * extractOrgSlug('wedillybird.vercel.app')        // → null
 * extractOrgSlug('foo.bar.wedillybird.com')       // → null (sous-sous-domaine)
 */
export function extractOrgSlug(host: string | null | undefined): string | null {
  const normalized = normalizeHost(host);
  if (!normalized) return null;

  // Vercel preview deployments — ne jamais traiter comme orga.
  if (normalized.endsWith('.vercel.app') || normalized === 'vercel.app') {
    return null;
  }

  // Localhost (dev) — l'override d'orga passe par ?orgPreview= dans le proxy.
  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === '127.0.0.1' ||
    normalized.endsWith('.127.0.0.1')
  ) {
    return null;
  }

  // Match `<slug>.<root-domain>` — un seul niveau de sous-domaine.
  for (const root of ROOT_DOMAINS) {
    if (normalized === root) return null;
    const suffix = `.${root}`;
    if (!normalized.endsWith(suffix)) continue;
    const candidate = normalized.slice(0, -suffix.length);
    // Refuse les sous-sous-domaines (`foo.bar.wedillybird.com`).
    if (candidate.includes('.')) return null;
    if (!candidate) return null;
    if (RESERVED_SUBDOMAINS.has(candidate)) return null;
    if (!SLUG_RE.test(candidate)) return null;
    return candidate;
  }

  return null;
}

/**
 * Liste des sous-domaines réservés à l'infra. Exposée pour la
 * documentation et les tests — ne mutez pas le set retourné.
 */
export function getReservedSubdomains(): ReadonlySet<string> {
  return RESERVED_SUBDOMAINS;
}

/**
 * Domaine à poser sur un cookie qui doit SURVIVRE au passage d'un
 * sous-domaine d'agence vers l'apex — `null` quand il faut laisser le cookie
 * host-only.
 *
 * Le cas qui l'impose : une invitée arrive sur `sarah.wedillybird.com/...?ref=SARAH12`
 * (le lien qu'une agence partage), puis achète depuis l'app, dont le checkout
 * (`/api/checkout`) vit sur l'apex. Un cookie host-only posé sur le
 * sous-domaine n'est jamais renvoyé à l'apex : l'attribution ET la remise
 * étaient perdues sans le moindre signal.
 *
 * `null` — donc host-only — dans les trois cas où un domaine partagé serait
 * faux ou refusé par le navigateur :
 *  - `localhost` / `127.0.0.1` (dev) : pas de domaine parent à partager ;
 *  - `*.vercel.app` : suffixe public, tout `domain` est rejeté ;
 *  - un host inconnu des `ROOT_DOMAINS` : on ne devine pas un domaine parent.
 */
export function sharedCookieDomain(host: string | null | undefined): string | null {
  const normalized = normalizeHost(host);
  if (!normalized) return null;
  if (normalized === 'vercel.app' || normalized.endsWith('.vercel.app')) return null;
  for (const root of ROOT_DOMAINS) {
    if (normalized === root || normalized.endsWith(`.${root}`)) return `.${root}`;
  }
  return null;
}
