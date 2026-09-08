import { expect, test } from '@playwright/test';

test.describe('Auth — sign-in page', () => {
  test('renders the sign-in form with accessible labels', async ({ page }) => {
    await page.goto('/sign-in');

    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Bienvenue|Connexion/i);
    await expect(page.getByLabel('Numéro WhatsApp')).toBeVisible();
    await expect(page.getByRole('button', { name: /envoyer le code/i })).toBeVisible();
  });

  test('shows an inline error for invalid phone on submit', async ({ page }) => {
    await page.goto('/sign-in');

    const phone = page.getByLabel('Numéro WhatsApp');
    await phone.fill('abc');
    await page.getByRole('button', { name: /envoyer le code/i }).click();

    await expect(page.locator('#auth-error')).toBeVisible();
    await expect(page.locator('#auth-error')).toContainText(/invalide/i);
  });
});

test.describe('Auth — sign-up (entrée de tunnel)', () => {
  test('renders the auth form directly and preserves plan/billing attribution', async ({
    page,
  }) => {
    await page.goto('/sign-up?plan=business&billing=monthly');
    // Pas de redirection vers /sign-in : /sign-up rend le formulaire (même UI)
    // pour instrumenter l'entrée de tunnel (signup_started) et conserver les
    // paramètres d'attribution plan/billing passés par les CTA pricing.
    await expect(page).toHaveURL(/\/sign-up/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Bienvenue|Connexion/i);
    await expect(page.getByLabel('Numéro WhatsApp')).toBeVisible();
  });
});

test.describe('Auth — verify page', () => {
  test('redirects to /sign-in when no phone in query', async ({ page }) => {
    await page.goto('/verify');
    await page.waitForURL((url) => url.pathname.endsWith('/sign-in'));
  });

  test('redirects to /sign-in when phone is not a valid E.164', async ({ page }) => {
    await page.goto('/verify?phone=abc');
    await page.waitForURL((url) => url.pathname.endsWith('/sign-in'));
  });

  test('renders the OTP form when given a valid phone', async ({ page }) => {
    await page.goto('/verify?phone=%2B33612345678');

    await expect(page.getByRole('heading', { level: 1 })).toContainText('Vérifiez');
    const cells = page.getByRole('textbox');
    await expect(cells).toHaveCount(6);
    await expect(page.getByRole('button', { name: /^vérifier/i })).toBeVisible();
  });

  test('allows pasting the code into the first cell', async ({ page }) => {
    await page.goto('/verify?phone=%2B33612345678');
    const cells = page.getByRole('textbox');

    // Attendre l'hydratation AVANT de taper, sinon le test ment.
    //
    // Les cases sont contrôlées par React et l'avance de focus vit dans
    // `onChange`. Taper avant l'hydratation écrit dans le DOM natif — la
    // valeur s'affiche, `toHaveValue` passe — mais aucun handler React ne
    // tourne : le focus ne bouge jamais, et l'échec ressemble à un bug
    // d'auto-avance alors que le composant n'a simplement jamais été monté.
    // C'est ce qui rendait ce test rouge sur les runners lents (webkit).
    //
    // L'auto-focus de la première case est un effet CLIENT : l'attendre est
    // donc la preuve que React a pris la main.
    await expect(cells.first()).toBeFocused({ timeout: 10_000 });

    await page.keyboard.insertText('1');
    await expect(cells.first()).toHaveValue('1');
    await expect(cells.nth(1)).toBeFocused({ timeout: 10_000 });
  });
});

test.describe('Auth — protected routes', () => {
  test('unauthenticated /onboarding redirects to /sign-in', async ({ page }) => {
    await page.goto('/onboarding');
    await page.waitForURL((url) => url.pathname.endsWith('/sign-in'));
  });

  test('unauthenticated /dashboard redirects to /sign-in', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForURL((url) => url.pathname.endsWith('/sign-in'));
  });
});
