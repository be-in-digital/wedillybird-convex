import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (p: string) => readFileSync(p, 'utf8');

/**
 * Le defaut d'origine : `/rejoindre/<token>` envoyait vers
 * `/sign-in?next=/rejoindre/<token>`, mais AUCUNE etape du flux ne lisait
 * `next`. La partenaire se connectait, atterrissait sur l'onboarding
 * generique, choisissait « couple », et son invitation n'etait jamais
 * consommee — elle se retrouvait a devoir payer un forfait.
 *
 * Le lien ne vaut que si toute la chaine le porte. Chaque maillon manquant le
 * perd silencieusement, d'ou un test par maillon.
 */
describe('report de la destination apres connexion', () => {
  it("la page d'invitation emet bien un next", () => {
    expect(read('app/[locale]/(auth)/rejoindre/[token]/page.tsx')).toContain(
      '/sign-in?next=${encodeURIComponent(`/rejoindre/${token}`)}',
    );
  });

  it('la page sign-in le lit et le valide', () => {
    const page = read('app/[locale]/(auth)/sign-in/page.tsx');
    expect(page).toContain('safeNextPath(');
    expect(page).toContain('<AuthMethodSwitcher next={next} />');
  });

  it('les deux methodes de connexion le recoivent', () => {
    expect(read('components/auth/auth-method-switcher.tsx')).toContain(
      '<SignInForm next={next} /> : <MagicLinkForm next={next} />',
    );
  });

  it('la voie OTP le transporte jusqu a la verification, puis y retourne', () => {
    expect(read('components/auth/sign-in-form.tsx')).toContain(
      'query: next ? { phone, next } : { phone }',
    );
    const verifyPage = read('app/[locale]/(auth)/verify/page.tsx');
    expect(verifyPage).toContain('safeNextPath(');
    expect(verifyPage).toContain('<VerifyForm phone={phone!} next={next} />');
    expect(read('components/auth/verify-form.tsx')).toContain(
      "router.push((next ?? '/onboarding') as never)",
    );
  });

  it('la voie e-mail le porte jusque dans le lien, et la route le respecte', () => {
    expect(read('components/auth/magic-link-form.tsx')).toContain("formData.set('next', next)");
    expect(read('app/[locale]/(auth)/actions.ts')).toContain('safeNextPath(');
    expect(read('convex/auth.ts')).toContain('...(next ? { next } : {})');
    expect(read('convex/emailActions.ts')).toContain(
      "${next ? `&next=${encodeURIComponent(next)}` : ''}",
    );
    const route = read('app/api/auth/magic-link/verify/route.ts');
    expect(route).toContain("safeNextPath(url.searchParams.get('next'))");
    expect(route).toContain("new URL(next ?? '/onboarding', request.url)");
  });

  it('chaque etape qui accepte un next le revalide', () => {
    // Une seule validation en entree ne suffit pas : les URL intermediaires
    // (/verify?next=, le lien e-mail) sont editables a la main.
    for (const file of [
      'app/[locale]/(auth)/sign-in/page.tsx',
      'app/[locale]/(auth)/verify/page.tsx',
      'app/[locale]/(auth)/actions.ts',
      'app/api/auth/magic-link/verify/route.ts',
    ]) {
      expect(read(file), file).toContain('safeNextPath');
    }
  });
});
