import { test, expect } from '@playwright/test';

test.describe('Landing page', () => {
  test('rend le hero FR avec titre éditorial et CTA principal', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Wedillybird/);

    const hero = page.getByRole('heading', { level: 1 });
    await expect(hero).toBeVisible();
    // Promesse V5 (audit sept. 2026) : concrète, dit ce que fait le produit.
    await expect(hero).toContainText(/invitations de mariage/i);

    // CTA primary = "Préparer mon mariage".
    await expect(page.getByRole('link', { name: /préparer mon mariage/i }).first()).toBeVisible();
  });

  test('le CTA principal du hero est visible sans scroller, bannière cookies comprise', async ({
    page,
  }) => {
    await page.goto('/');
    const cta = page.getByRole('link', { name: /préparer mon mariage/i }).first();
    // Laisse la bannière cookies apparaître (1,5 s) : elle ne doit pas
    // recouvrir le CTA.
    await expect(page.getByRole('region', { name: /cookies/i })).toBeVisible();
    const box = await cta.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    const banner = await page.getByRole('region', { name: /cookies/i }).boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
    // Le CTA se termine au-dessus du haut de la bannière.
    expect(box!.y + box!.height).toBeLessThanOrEqual(banner!.y);
  });

  test("aucune preuve sociale inventée n'est affichée", async ({ page }) => {
    await page.goto('/');
    const body = page.locator('body');
    await expect(body).not.toContainText(/1 240 mariages/i);
    await expect(body).not.toContainText(/4,9 \/ 5/);
    await expect(page.locator('#testimonials')).toHaveCount(0);
  });

  test('rend les chapitres narratifs V4 (manifesto, cinematic, FAQ)', async ({ page }) => {
    await page.goto('/');
    // Chapitre 02 — Manifesto (absorbe Stats + Comparison via diptyque + pull-quote)
    await expect(
      page.getByRole('heading', { name: /un mariage ne se prépare plus/i }),
    ).toBeVisible();
    // Chapitre 04 — Cinématique invitation
    await expect(page.getByRole('heading', { name: /une enveloppe qui s'ouvre/i })).toBeVisible();
    // Chapitre 07 — FAQ
    await expect(
      page.getByRole('heading', { name: /tout ce que vous voulez savoir/i }),
    ).toBeVisible();
  });

  test('la section features affiche les quatre piliers', async ({ page }) => {
    await page.goto('/');
    const features = page.locator('#features');
    await expect(features).toBeVisible();

    await expect(features.getByRole('heading', { name: /invitations whatsapp/i })).toBeVisible();
    // Le titre V4 est "RSVP en temps réel" — pattern flexible avec .* pour
    // tolérer l'évolution du wording (en|live|...) sans casser le test.
    await expect(features.getByRole('heading', { name: /rsvp.*temps.*réel/i })).toBeVisible();
    await expect(features.getByRole('heading', { name: /check-in/i })).toBeVisible();
    await expect(features.getByRole('heading', { name: /galerie partagée/i })).toBeVisible();
  });

  test('la grille de pricing affiche les deux plans Essentiel et Premium', async ({ page }) => {
    await page.goto('/');
    const pricing = page.locator('#pricing');
    await expect(pricing).toBeVisible();

    await expect(pricing.getByRole('heading', { name: /essentiel/i })).toBeVisible();
    await expect(pricing.getByRole('heading', { name: /^premium$/i })).toBeVisible();
    // L'ancien tier 'free' (Gratuit) ne doit plus apparaître comme heading
    // de plan. Le mot 'gratuit' reste légitime dans la trust line ("Report
    // gratuit en cas d'annulation"), donc on cible un heading exact.
    await expect(pricing.getByRole('heading', { name: /^gratuit$/i })).toHaveCount(0);
    // Le bandeau d'upsell post-mariage doit être affiché.
    await expect(pricing.getByTestId('upsell-note')).toBeVisible();
  });

  test("le CTA principal d'inscription est présent dans le header", async ({ page }) => {
    await page.goto('/');
    const header = page.getByRole('banner');
    await expect(header.getByRole('link', { name: /créer un compte/i })).toBeVisible();
  });

  test('un compte existant trouve par où se connecter', async ({ page }) => {
    // Le flow OTP ouvre indifféremment un compte neuf ou un compte existant,
    // d'où l'unique bouton "Créer un compte" d'origine. Un retour utilisateur a
    // montré que ça ne se lit pas : on ne trouvait pas la connexion, on cliquait
    // "Créer un compte" faute de mieux, et on se retrouvait connecté sans
    // comprendre comment. Le point d'entrée doit donc exister, à toute largeur.
    await page.goto('/');
    const width = page.viewportSize()?.width ?? 0;

    if (width >= 640) {
      const signIn = page.getByRole('banner').getByRole('link', { name: /se connecter/i });
      await expect(signIn).toBeVisible();
      await expect(signIn).toHaveAttribute('href', '/sign-in');
      return;
    }

    // Sous 640px la barre sticky est pleine au pixel près (logo + CTA +
    // hamburger) : le lien vit en tête du bottom-sheet.
    await page.getByRole('button', { name: /ouvrir le menu/i }).click();
    const signIn = page.getByRole('link', { name: /se connecter/i });
    await expect(signIn).toBeVisible();
    await expect(signIn).toHaveAttribute('href', '/sign-in');
  });

  test('la navigation active suit les sections Tarifs puis FAQ', async ({ page }) => {
    const viewport = page.viewportSize();
    test.skip((viewport?.width ?? 0) < 768, 'La navigation de section est desktop-only.');

    await page.goto('/');

    const nav = page.getByRole('navigation', { name: /navigation principale/i });
    const navLinks = nav.getByRole('link');

    // Landing mono-audience couple : le lien "Pour les pros" a été retiré (offre
    // agence déplacée sur /forfaits-pros et /pros) et la section Témoignages
    // (voix fictives) a été supprimée à l'audit de sept. 2026.
    await expect(navLinks).toHaveText(['Fonctionnalités', 'Tarifs', 'Questions']);
    await expect(nav.getByRole('link', { name: 'Tarifs' })).toHaveAttribute('href', '/#pricing');
    await expect(nav.getByRole('link', { name: 'Questions' })).toHaveAttribute('href', '/#faq');

    await page.locator('#pricing').evaluate((section) => {
      window.scrollTo(0, section.getBoundingClientRect().top + window.scrollY - 120);
    });
    await expect(nav.getByRole('link', { name: 'Tarifs' })).toHaveAttribute('aria-current', 'true');

    await page.locator('#faq').evaluate((section) => {
      window.scrollTo(0, section.getBoundingClientRect().top + window.scrollY - 120);
    });
    await expect(nav.getByRole('link', { name: 'Questions' })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  test('lang html vaut fr', async ({ page }) => {
    await page.goto('/');
    const lang = await page.locator('html').getAttribute('lang');
    expect(lang).toBe('fr');
  });

  test('clic sur CTA secondaire ouvre la démo publique', async ({ page }) => {
    await page.goto('/');
    // CTA secondaire V5 = "Voir une invitation" → /demo (preuve produit).
    await page
      .getByRole('link', { name: /voir une invitation/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/demo$/);
  });
});

test.describe('Démo publique /demo', () => {
  test("rend l'invitation fictive sans compte ni backend", async ({ page }) => {
    await page.goto('/demo');
    await expect(page).toHaveTitle(/démo/i);
    // Le bandeau dit que c'est une démo et propose de créer la sienne.
    await expect(page.getByText(/invitation de démonstration/i)).toBeVisible();
    await expect(page.getByRole('link', { name: /créer la mienne/i })).toBeVisible();
    // Le couple fictif et le formulaire RSVP sont rendus côté serveur (masqués
    // via aria-hidden tant que la cinématique joue → locator CSS, pas de rôle).
    await expect(page.locator('h1')).toContainText(/Léa/);
    await expect(page.getByTestId('rsvp-form')).toBeAttached();
    // Pas de lien galerie : il n'existe pas de galerie fictive.
    await expect(page.getByRole('link', { name: /galerie partagée/i })).toHaveCount(0);
  });

  test('le RSVP de démo est accepté localement', async ({ page }) => {
    await page.goto('/demo');
    // Passe la cinématique d'ouverture en la marquant comme déjà vue, puis
    // re-navigue (un `reload` la rejoue toujours, par conception du shell).
    await page.evaluate(() => sessionStorage.setItem('wbb-cinematic-seen:demo', '1'));
    await page.goto('/demo');
    await expect(page.getByTestId('rsvp-form')).toBeVisible();
    // L'input radio est `sr-only` : on clique son libellé.
    await page.getByText('Je confirme', { exact: true }).click();
    await expect(page.getByTestId('rsvp-option-attending')).toBeChecked();
    await page.getByTestId('submit-rsvp').click();
    await expect(page.getByTestId('rsvp-success')).toBeVisible();
  });
});

test.describe('Accessibilité basique', () => {
  test('un seul h1 sur la landing', async ({ page }) => {
    await page.goto('/');
    const h1s = page.getByRole('heading', { level: 1 });
    await expect(h1s).toHaveCount(1);
  });

  test('le logo/brand est un lien vers la racine', async ({ page }) => {
    await page.goto('/');
    const brand = page.getByRole('link', { name: 'Wedillybird' }).first();
    await expect(brand).toHaveAttribute('href', '/');
  });
});
