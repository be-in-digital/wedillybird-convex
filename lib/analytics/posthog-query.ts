import 'server-only';

/**
 * Client de LECTURE PostHog (API Query / HogQL) pour afficher l'analytics
 * marketing DANS le back-office Super Admin (cf. /admin/acquisition).
 *
 * ⚠️ Distinct de `posthog-server.ts` (qui ÉCRIT des events avec le token public
 * `phc_`). Lire les données nécessite une **clé personnelle** scopée
 * `query:read` → env `POSTHOG_PERSONAL_API_KEY`. Sans elle, les helpers
 * renvoient `{ state: 'not_configured' }` (l'UI affiche un encart de setup,
 * jamais de crash).
 *
 * L'API Query accepte les mêmes objets que les insights (FunnelsQuery,
 * TrendsQuery) — on réutilise donc la taxonomie déjà instrumentée.
 */

// L'API Query vit sur le host « app » (us.posthog.com), pas sur l'ingestion
// (us.i.posthog.com). Configurable pour le cloud EU.
const POSTHOG_API_HOST = process.env.POSTHOG_API_HOST ?? 'https://us.posthog.com';
const PROJECT_ID = process.env.POSTHOG_PROJECT_ID ?? '469980';

export type NamedValue = { label: string; value: number };

/**
 * Comportement sur la landing — ce qu'il faut regarder pour décider quoi
 * améliorer : jusqu'où les visiteurs descendent (`section_viewed`), quelles
 * objections ils ouvrent (`faq_opened`), quelles pages ils voient, et s'ils
 * essaient la démo (`demo_rsvp_submitted`).
 */
export type LandingBehavior = {
  /** Visiteurs uniques ayant atteint chaque section (ordre du scroll). */
  sectionsReached: NamedValue[];
  /** Questions FAQ ouvertes (signal d'objection). */
  faqOpened: NamedValue[];
  /** Pages vues par chemin (top 8). */
  pagesByPath: NamedValue[];
  /** RSVP de démonstration envoyés (engagement avec la preuve produit). */
  demoRsvp: number;
  /** Part des pages vues capturées sans cookie (visiteurs sans consentement). */
  cookielessShare: number | null;
};

export type AcquisitionAnalytics =
  | { state: 'not_configured' }
  | { state: 'error'; message: string }
  | {
      state: 'ok';
      days: number;
      funnel: NamedValue[];
      traffic: { pageviews: number; uniqueVisitors: number };
      ctaBySource: NamedValue[];
      signupByLocale: NamedValue[];
      planByTier: NamedValue[];
      landing: LandingBehavior;
    };

type TrendsResultRow = {
  label?: string;
  count?: number;
  aggregated_value?: number;
  breakdown_value?: string | number | null;
  data?: number[];
};

/** POST vers l'API Query. Suppose la clé présente (vérifiée en amont). Jette sur erreur HTTP. */
async function postQuery<T>(query: Record<string, unknown>, key: string): Promise<T> {
  const res = await fetch(`${POSTHOG_API_HOST}/api/projects/${PROJECT_ID}/query/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
    // L'admin n'a pas besoin du temps réel : cache 5 min côté Next.
    next: { revalidate: 300 },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`PostHog query ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

/** Agrégat d'une série trends (count, sinon aggregated_value, sinon somme des points). */
function rowAggregate(row: TrendsResultRow | undefined): number {
  if (!row) return 0;
  if (typeof row.count === 'number') return row.count;
  if (typeof row.aggregated_value === 'number') return row.aggregated_value;
  return (row.data ?? []).reduce((a, b) => a + b, 0);
}

const FUNNEL_STEPS = [
  { event: '$pageview', label: 'Visites' },
  { event: 'cta_clicked', label: 'Clic CTA' },
  { event: 'signup_started', label: 'Inscription démarrée' },
  { event: 'signup_completed', label: 'Compte créé' },
  { event: 'onboarding_completed', label: 'Onboarding fini' },
  { event: 'checkout_started', label: 'Checkout' },
  { event: 'purchase_completed', label: 'Achat' },
] as const;

async function fetchFunnel(days: number, key: string): Promise<NamedValue[]> {
  const data = await postQuery<{ results: Array<{ count?: number }> }>(
    {
      kind: 'FunnelsQuery',
      series: FUNNEL_STEPS.map((s) => ({
        kind: 'EventsNode',
        event: s.event,
        custom_name: s.label,
      })),
      funnelsFilter: {
        funnelVizType: 'steps',
        funnelOrderType: 'ordered',
        funnelWindowInterval: 14,
        funnelWindowIntervalUnit: 'day',
      },
      dateRange: { date_from: `-${days}d` },
    },
    key,
  );
  return FUNNEL_STEPS.map((s, i) => ({ label: s.label, value: data.results?.[i]?.count ?? 0 }));
}

async function fetchTraffic(
  days: number,
  key: string,
): Promise<{ pageviews: number; uniqueVisitors: number }> {
  const data = await postQuery<{ results: TrendsResultRow[] }>(
    {
      kind: 'TrendsQuery',
      series: [
        { kind: 'EventsNode', event: '$pageview', math: 'total' },
        { kind: 'EventsNode', event: '$pageview', math: 'dau' },
      ],
      dateRange: { date_from: `-${days}d` },
      interval: 'day',
    },
    key,
  );
  return {
    pageviews: rowAggregate(data.results?.[0]),
    uniqueVisitors: rowAggregate(data.results?.[1]),
  };
}

/** Trends agrégé avec breakdown sur une propriété event → liste triée desc. */
async function fetchBreakdown(
  event: string,
  property: string,
  days: number,
  key: string,
  math: 'total' | 'dau' = 'total',
): Promise<NamedValue[]> {
  const data = await postQuery<{ results: TrendsResultRow[] }>(
    {
      kind: 'TrendsQuery',
      series: [{ kind: 'EventsNode', event, math }],
      breakdownFilter: { breakdowns: [{ property, type: 'event' }] },
      dateRange: { date_from: `-${days}d` },
      interval: 'day',
    },
    key,
  );
  return (data.results ?? [])
    .map((row) => ({
      label: String(row.breakdown_value ?? row.label ?? '—'),
      value: rowAggregate(row),
    }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);
}

/** Total d'un event sur la période. */
async function fetchTotal(event: string, days: number, key: string): Promise<number> {
  const data = await postQuery<{ results: TrendsResultRow[] }>(
    {
      kind: 'TrendsQuery',
      series: [{ kind: 'EventsNode', event, math: 'total' }],
      dateRange: { date_from: `-${days}d` },
      interval: 'day',
    },
    key,
  );
  return rowAggregate(data.results?.[0]);
}

/** Ordre de lecture des sections de la landing (= ordre du scroll). */
const LANDING_SECTION_ORDER = ['features', 'pricing', 'faq'] as const;

async function fetchLandingBehavior(days: number, key: string): Promise<LandingBehavior> {
  const [sections, faqOpened, pagesByPath, demoRsvp, pageviewsByMode] = await Promise.all([
    // `dau` = visiteurs uniques ayant atteint la section (pas le nombre de
    // scrolls) : c'est la courbe de fuite qu'on veut lire.
    fetchBreakdown('section_viewed', 'id', days, key, 'dau'),
    fetchBreakdown('faq_opened', 'question', days, key),
    fetchBreakdown('$pageview', '$pathname', days, key),
    fetchTotal('demo_rsvp_submitted', days, key),
    fetchBreakdown('$pageview', '$cookieless_mode', days, key),
  ]);
  const byId = new Map(sections.map((s) => [s.label, s.value]));
  const sectionsReached = LANDING_SECTION_ORDER.map((id) => ({
    label: id,
    value: byId.get(id) ?? 0,
  }));
  const total = pageviewsByMode.reduce((a, r) => a + r.value, 0);
  const cookieless = pageviewsByMode.find((r) => r.label === 'true')?.value ?? 0;
  return {
    sectionsReached,
    faqOpened: faqOpened.slice(0, 8),
    pagesByPath: pagesByPath.slice(0, 8),
    demoRsvp,
    cookielessShare: total > 0 ? cookieless / total : null,
  };
}

/**
 * Point d'entrée unique pour la page admin : renvoie tout le marketing en un
 * objet, ou un état `not_configured` / `error` (jamais de throw vers la page).
 */
export async function getAcquisitionAnalytics(days = 30): Promise<AcquisitionAnalytics> {
  const key = process.env.POSTHOG_PERSONAL_API_KEY;
  if (!key) return { state: 'not_configured' };
  try {
    const [funnel, traffic, ctaBySource, signupByLocale, planByTier, landing] = await Promise.all([
      fetchFunnel(days, key),
      fetchTraffic(days, key),
      fetchBreakdown('cta_clicked', 'source', days, key),
      fetchBreakdown('signup_completed', 'locale', days, key),
      fetchBreakdown('pricing_plan_selected', 'tier', days, key),
      fetchLandingBehavior(days, key),
    ]);
    return {
      state: 'ok',
      days,
      funnel,
      traffic,
      ctaBySource,
      signupByLocale,
      planByTier,
      landing,
    };
  } catch (e) {
    return { state: 'error', message: e instanceof Error ? e.message : 'unknown' };
  }
}

// --- Session Replay (liste native dans l'admin) ---

export type SessionSummary = {
  id: string;
  startTime: string | null;
  durationSec: number;
  clicks: number;
  startUrl: string | null;
  person: string | null;
};

export type RecentSessions =
  | { state: 'not_configured' }
  | { state: 'scope_missing' } // clé sans `session_recording:read`
  | { state: 'error'; message: string }
  | { state: 'ok'; sessions: SessionSummary[] };

/** Lien profond vers le player PostHog d'un enregistrement. */
export function replayUrl(id: string): string {
  return `${POSTHOG_API_HOST}/project/${PROJECT_ID}/replay/${id}`;
}

/** Lien vers la liste complète des rejeux. */
export function replayListUrl(): string {
  return `${POSTHOG_API_HOST}/project/${PROJECT_ID}/replay`;
}

/**
 * Derniers enregistrements de session. Nécessite le scope
 * `session_recording:read` sur la clé (sinon `scope_missing`). Ne throw jamais.
 */
export async function getRecentSessions(limit = 8): Promise<RecentSessions> {
  const key = process.env.POSTHOG_PERSONAL_API_KEY;
  if (!key) return { state: 'not_configured' };
  try {
    const res = await fetch(
      `${POSTHOG_API_HOST}/api/projects/${PROJECT_ID}/session_recordings/?limit=${limit}`,
      { headers: { Authorization: `Bearer ${key}` }, next: { revalidate: 120 } },
    );
    if (res.status === 403) return { state: 'scope_missing' };
    if (!res.ok) return { state: 'error', message: `HTTP ${res.status}` };
    const json = (await res.json()) as { results?: Array<Record<string, unknown>> };
    const sessions: SessionSummary[] = (json.results ?? []).map((r) => {
      const person = r.person as { name?: string } | null | undefined;
      return {
        id: String(r.id ?? ''),
        startTime: typeof r.start_time === 'string' ? r.start_time : null,
        durationSec: Number(r.recording_duration ?? 0),
        clicks: Number(r.click_count ?? 0),
        startUrl: typeof r.start_url === 'string' ? r.start_url : null,
        person: person?.name ?? (typeof r.distinct_id === 'string' ? r.distinct_id : null),
      };
    });
    return { state: 'ok', sessions };
  } catch (e) {
    return { state: 'error', message: e instanceof Error ? e.message : 'unknown' };
  }
}
