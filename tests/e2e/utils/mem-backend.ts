import { expect, test, type Page } from '@playwright/test';

/**
 * Helpers pour la pile de test « backend Convex en mémoire ».
 *
 * Ils supposent `tests/e2e/support/convex-mem-server.ts` démarré (cf. son
 * README) : les VRAIES fonctions Convex y tournent, et les e-mails y sont
 * capturés au lieu d'être envoyés. C'est ce qui rend la connexion par e-mail
 * automatisable — jusqu'ici, aucun code de vérification n'était récupérable
 * (les tables ne stockent que des hashs), et toute page authentifiée était
 * donc hors de portée des tests navigateur.
 */
export const MEM_BACKEND_URL = process.env.CONVEX_MEM_URL ?? 'http://127.0.0.1:3210';

/** `true` quand la pile en mémoire n'est pas là — à passer à `test.skip`. */
export async function memBackendUnavailable(): Promise<boolean> {
  try {
    const res = await fetch(`${MEM_BACKEND_URL}/__test__/health`);
    return !res.ok;
  } catch {
    return true;
  }
}

export const MEM_BACKEND_REQUIRED =
  'Requiert le backend Convex en mémoire — cf. tests/e2e/support/README.md';

/** Base + boîte d'envoi vierges. Chaque spec part d'un état connu. */
export async function resetBackend(): Promise<void> {
  const res = await fetch(`${MEM_BACKEND_URL}/__test__/reset`, { method: 'POST' });
  if (!res.ok) throw new Error(`reset failed: ${res.status}`);
}

/**
 * Branche une suite sur le backend en mémoire : exécution SÉQUENTIELLE, saut
 * propre s'il n'est pas là, base vierge avant chaque test.
 *
 * Le mode `default` n'est pas un détail de confort : il annule le
 * `fullyParallel` de la config pour cette suite. Il n'existe qu'UN backend
 * pour tout le run, et `resetBackend()` en vide la base — deux tests
 * concurrents se l'effacent donc mutuellement en plein vol. Le symptôme ne
 * ressemble en rien à sa cause : la page admin s'affiche (l'admin existe
 * encore), puis l'action suivante repart en `FORBIDDEN: admin role required`
 * parce que le `beforeEach` d'un test voisin vient de supprimer ce compte.
 *
 * `default` plutôt que `serial` : on veut l'ordre, pas la cascade. En `serial`,
 * un échec saute tous les tests suivants du groupe — un gate de CI qui masque
 * six résultats sur sept dès la première rougeur.
 */
export function useMemBackend(): void {
  test.describe.configure({ mode: 'default' });

  let backendUp = false;

  test.beforeAll(async () => {
    backendUp = !(await memBackendUnavailable());
    // En CI, se sauter EST la panne : un `describe` entier absent du rapport
    // s'y lit comme un succès. C'est ce qui a laissé passer une régression sur
    // la création d'affilié pendant que le tableau de bord restait vert. Le
    // backend y est donc un prérequis (`CONVEX_MEM=1`), jamais une option ; en
    // local, il reste opt-in et le saut garde son sens.
    if (!backendUp && process.env.CI) throw new Error(MEM_BACKEND_REQUIRED);
  });

  test.beforeEach(async () => {
    test.skip(!backendUp, MEM_BACKEND_REQUIRED);
    await resetBackend();
  });
}

interface CapturedEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  sentAt: number;
}

export async function sentEmails(): Promise<CapturedEmail[]> {
  const res = await fetch(`${MEM_BACKEND_URL}/__test__/emails`);
  const body: unknown = await res.json();
  return (
    Array.isArray(body) ? body : ((body as { emails?: CapturedEmail[] }).emails ?? [])
  ) as CapturedEmail[];
}

/** Appelle une fonction Convex, y compris interne (seeding). */
export async function callConvex<T = unknown>(
  type: 'query' | 'mutation' | 'action',
  path: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const res = await fetch(`${MEM_BACKEND_URL}/__test__/call`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, path, args }),
  });
  const body = (await res.json()) as { status?: string; value?: T; errorMessage?: string };
  if (!res.ok || body.status === 'error') {
    throw new Error(`${path}: ${body.errorMessage ?? res.status}`);
  }
  return body.value as T;
}

/**
 * Attend le dernier e-mail adressé à `to` et en extrait la première URL qui
 * matche `pattern`. L'envoi passe par le scheduler Convex : on laisse à la
 * boîte le temps d'arriver plutôt que de supposer qu'elle est déjà là.
 */
export async function waitForEmailLink(to: string, pattern: RegExp): Promise<string> {
  const deadline = Date.now() + 15_000;
  let lastSubjects: string[] = [];
  while (Date.now() < deadline) {
    const all = await sentEmails();
    lastSubjects = all.map((e) => `${e.to} · ${e.subject}`);
    const mine = all.filter((e) => e.to.toLowerCase() === to.toLowerCase());
    const latest = mine[mine.length - 1];
    if (latest) {
      const source = `${latest.html}\n${latest.text}`;
      const match = source.match(pattern);
      // Les entités HTML (`&amp;`) casseraient l'URL au moment du `goto`.
      if (match) return match[0].replace(/&amp;/g, '&');
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `Aucun e-mail pour ${to} matchant ${pattern}. Reçus : ${lastSubjects.join(', ')}`,
  );
}

/**
 * Connexion par e-mail (magic link), de bout en bout : l'onglet « Email » du
 * sélecteur de méthode, le formulaire, l'e-mail réellement produit par Convex,
 * puis le lien suivi jusqu'à la pose du cookie de session.
 */
export async function signInByEmail(page: Page, email: string): Promise<void> {
  await page.goto('/sign-in');

  // Le sélecteur de méthode est un composant client : un clic qui arrive avant
  // l'hydratation ne fait rien (le panneau reste sur WhatsApp). On réessaie
  // jusqu'à ce que l'onglet soit réellement sélectionné.
  const emailTab = page.getByRole('tab', { name: 'Email', exact: true });
  await expect(emailTab).toBeVisible();
  await expect(async () => {
    await emailTab.click();
    await expect(emailTab).toHaveAttribute('aria-selected', 'true', { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });

  await page.getByLabel(/adresse email/i).fill(email);
  await page.getByRole('button', { name: /recevoir mon lien/i }).click();
  await expect(page.getByText(/vérifiez votre boîte mail/i)).toBeVisible();

  const link = await waitForEmailLink(email, /https?:\/\/[^"\s<)]+magic-link\/verify[^"\s<)]*/);
  await page.goto(link);
  await page.waitForURL((url) => !url.pathname.includes('/sign-in'));
}
