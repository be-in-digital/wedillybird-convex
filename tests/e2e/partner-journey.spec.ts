import { expect, test } from '@playwright/test';
import {
  callConvex,
  MEM_BACKEND_REQUIRED,
  memBackendUnavailable,
  resetBackend,
  signInByEmail,
  waitForEmailLink,
} from './utils/mem-backend';

/**
 * Le partenariat, dans un vrai navigateur, contre les vraies fonctions Convex.
 *
 * Ce que ces tests couvrent et que rien d'autre ne pouvait couvrir : la
 * connexion (aucun code de vérification n'était récupérable jusqu'ici), le
 * rendu réel des pages authentifiées, et surtout le fait que le partenaire
 * puisse ATTEINDRE son espace — la page existait sans qu'aucun lien n'y mène.
 */

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@wedillybird.test';
const PARTNER_EMAIL = 'sarah@yourweddingmethod.test';

test.describe('Parcours partenaire', () => {
  let backendUp = false;

  test.beforeAll(async () => {
    backendUp = !(await memBackendUnavailable());
  });

  test.beforeEach(async () => {
    test.skip(!backendUp, MEM_BACKEND_REQUIRED);
    await resetBackend();
  });

  test('connexion par e-mail : le lien reçu ouvre bien une session', async ({ page }) => {
    await signInByEmail(page, 'nouvelle@test.fr');
    // Un compte neuf part à l'onboarding : la session est donc bien posée.
    await expect(page).toHaveURL(/\/onboarding/);
    await page.goto('/dashboard');
    await expect(page).not.toHaveURL(/\/sign-in/);
  });

  test('un lien de connexion ne sert qu’une fois', async ({ page }) => {
    const emailTab = page
      .goto('/sign-in')
      .then(() => page.getByRole('tab', { name: 'Email', exact: true }));
    const tab = await emailTab;
    await expect(async () => {
      await tab.click();
      await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await page.getByLabel(/adresse email/i).fill('unefois@test.fr');
    await page.getByRole('button', { name: /recevoir mon lien/i }).click();
    const link = await waitForEmailLink(
      'unefois@test.fr',
      /https?:\/\/[^"\s<)]+magic-link\/verify[^"\s<)]*/,
    );
    await page.goto(link);
    await expect(page).not.toHaveURL(/\/sign-in/);

    // Rejoué : le jeton est consommé, on repart sur /sign-in avec une erreur.
    await page.context().clearCookies();
    await page.goto(link);
    await expect(page).toHaveURL(/\/sign-in\?error=/);
  });

  test('de la création du partenariat à l’espace partenaire', async ({ page, browser }) => {
    /* ---------------- 1. L'admin ouvre le partenariat ---------------- */
    await signInByEmail(page, ADMIN_EMAIL);
    await page.goto('/admin/affiliates');
    await expect(page.getByText('Nouvel affilié')).toBeVisible();

    await page.getByTestId('affiliate-code').fill('SARAH12');
    await page.getByTestId('affiliate-rate').fill('10');
    // La remise filleul conditionne tout : à 0, aucun code n'est créé (le lien
    // suffit alors à attribuer) et l'admin ne voit ni code ni erreur.
    await page.getByTestId('affiliate-discount').fill('10');
    await page.getByTestId('affiliate-owner-email').fill('sarah@yourweddingmethod.test');
    await page.getByTestId('affiliate-display-name').fill('Sarah - Your Wedding Method');
    await page.getByTestId('affiliate-create').click();

    // Stripe n'est pas joignable ici : l'affilié DOIT exister quand même, et
    // l'admin doit le savoir explicitement. C'est le comportement conçu — le
    // lien attribue déjà, seul le code saisissable manque.
    await expect(page.getByText(/code promo Stripe NON créé/i)).toBeVisible();
    await expect(page.getByText('SARAH12').first()).toBeVisible();

    // On simule ce que Stripe aurait renvoyé, pour dérouler la suite.
    const affiliates = await callConvex<
      Array<{ id: string; code: string; shareCode: string | null }>
    >('query', 'affiliate:listAffiliates', { adminId: await adminId() });
    const sarah = affiliates.find((a) => a.code === 'SARAH12');
    expect(sarah).toBeTruthy();
    expect(sarah?.shareCode).toBeNull();
    await callConvex('mutation', 'affiliate:setAffiliateStripeCoupon', {
      adminId: await adminId(),
      affiliateId: sarah!.id,
      stripeCouponId: 'coup_test',
      stripePromotionCodeId: 'promo_test',
    });

    /* ---------------- 2. Il génère le lien d'invitation ---------------- */
    await page.reload();
    const row = page.locator('tr', { hasText: 'SARAH12' }).first();
    await row.getByRole('button', { name: /lien agence/i }).click();
    await expect(row.getByRole('button', { name: /copier le lien/i })).toBeVisible();

    const token = await inviteToken();
    expect(token).toHaveLength(24);

    /* ---------------- 3. Sarah ouvre le lien et accepte ---------------- */
    const partnerContext = await browser.newContext();
    const partnerPage = await partnerContext.newPage();
    await signInByEmail(partnerPage, PARTNER_EMAIL);

    await partnerPage.goto(`/rejoindre/${token}`);
    await expect(partnerPage.getByTestId('partner-invite-form')).toBeVisible();
    // Le code promis à sa communauté est annoncé dès la page d'acceptation.
    await expect(partnerPage.getByText(/SARAH12/)).toBeVisible();
    await partnerPage.getByTestId('partner-org-name').fill('Your Wedding Method');
    await partnerPage.getByTestId('partner-invite-submit').click();
    await partnerPage.waitForURL(/\/pro\//);

    /* ---------------- 4. Son espace partenaire est ATTEIGNABLE ---------------- */
    await partnerPage.goto('/partenaire');
    await expect(partnerPage.getByText('SARAH12')).toBeVisible();
    await expect(partnerPage.getByText(/ventes attribuées/i)).toBeVisible();

    await partnerContext.close();
  });

  test('le lien ?ref pose le cookie d’attribution, une seule fois', async ({ page, context }) => {
    await page.goto('/?ref=SARAH12');
    const first = (await context.cookies()).find((c) => c.name === 'wdb_ref');
    expect(first?.value).toBe('SARAH12');

    // First-touch : un second lien ne vole pas l'attribution du premier.
    await page.goto('/?ref=AUTRE99');
    const second = (await context.cookies()).find((c) => c.name === 'wdb_ref');
    expect(second?.value).toBe('SARAH12');
  });

  test('l’espace partenaire n’existe pas pour qui n’est pas partenaire', async ({ page }) => {
    await signInByEmail(page, 'quidam@test.fr');
    const res = await page.goto('/partenaire');
    expect(res?.status()).toBe(404);
  });
});

/** L'id du compte admin, pour les appels Convex directs. */
async function adminId(): Promise<string> {
  const user = await callConvex<{ _id: string } | null>('query', 'auth:_userByEmail', {
    email: ADMIN_EMAIL,
  });
  if (!user) throw new Error('admin introuvable');
  return user._id;
}

/** Le jeton du lien d'invitation vivant, lu côté backend. */
async function inviteToken(): Promise<string> {
  const invites = await callConvex<Array<{ token: string | null; state: string }>>(
    'query',
    'partnerInvites:listForAdmin',
    { adminId: await adminId() },
  );
  const usable = invites.find((i) => i.state === 'usable' && i.token);
  if (!usable?.token) throw new Error('aucun lien d’invitation utilisable');
  return usable.token;
}
