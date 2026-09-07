import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Gift } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { getSession } from '@/lib/auth/session';
import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';
import { PartnerInviteForm } from '@/components/partner/partner-invite-form';

/**
 * Acceptation d'un lien d'invitation partenaire.
 *
 * Ce que cette page remplace : une partenaire s'inscrivait, nommait son agence,
 * arrivait sur le dashboard et se heurtait au mur « choisissez un forfait »
 * (`orgHasActiveAccess`) avant d'avoir rien vu du produit. Ici, elle nomme son
 * agence et c'est fini — pas de carte bancaire, pas de forfait à choisir.
 *
 * Le jeton est la seule protection de la page : jamais indexée, et l'état du
 * lien (consommé / révoqué / périmé) est affiché tel quel plutôt que masqué,
 * pour qu'un lien mort donne une raison au lieu d'une page vide.
 *
 * Elle vit dans le groupe `(auth)`, PAS dans `(app)` : le layout de l'espace
 * authentifié redirige vers `/sign-in` avant même que la page ne s'exécute.
 * Une partenaire arrivait donc sur une page de connexion nue, sans jamais lire
 * ce qu'on lui offrait — et un lien mort ne se découvrait qu'APRÈS s'être
 * inscrite. C'est précisément ce que la vérification du jeton avant la session
 * cherche à éviter.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'PartnerInvite' });
  return {
    // L'onglet affichait le titre marketing générique du site : une partenaire
    // qui garde l'onglet ouvert ne retrouvait pas de quoi il s'agit.
    title: t('metaTitle'),
    robots: { index: false, follow: false },
  };
}

export default async function PartnerInvitePage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('PartnerInvite');

  const convex = getConvexServerClient();
  const invite = await convex.query(convexApi.getPartnerInviteByToken, { token });

  // Lien inconnu ou inutilisable : on le dit, sans jamais révéler à qui il
  // était destiné.
  if (!invite || invite.state !== 'usable') {
    const reason = !invite ? 'unknown' : invite.state;
    return (
      <div className="flex flex-col items-center gap-6 text-center">
        <h1
          className="font-display text-balance italic"
          style={{ fontSize: 'clamp(1.5rem, 3vw, 2rem)', lineHeight: 1.1 }}
        >
          {t('deadTitle')}
        </h1>
        <p className="text-sm text-[color:var(--color-muted-foreground)]">
          {t(`dead.${reason}` as 'dead.unknown')}
        </p>
        <p className="text-sm text-[color:var(--color-muted-foreground)]">{t('deadHelp')}</p>
        {/* Un lien mort laissait la page sans issue : aucun retour vers le site. */}
        <Link
          href="/"
          className="font-mono text-[10px] tracking-[0.32em] text-[color:var(--color-muted-foreground)] uppercase underline underline-offset-4"
        >
          {t('deadBackHome')}
        </Link>
      </div>
    );
  }

  // La session n'est lue qu'ici : inutile de forcer une connexion pour
  // apprendre que le lien est périmé.
  //
  // Et surtout : sans session on N'ENVOIE PAS vers `/sign-in`. Une partenaire
  // serait tombée sur une page de connexion générique sans avoir lu ce qu'on
  // lui offre — on lui demanderait de s'inscrire pour découvrir ensuite à quoi.
  // L'offre est donc rendue d'abord, et le bouton mène à l'inscription en
  // gardant le lien en `next`.
  // Deux offres distinctes derrière le même lien : espace agence, ou compte
  // personnel avec le mariage offert en Premium.
  const isCouple = invite.kind === 'couple';

  const session = await getSession();

  return (
    <div className="flex flex-col items-center gap-8">
      <span
        className="flex h-14 w-14 items-center justify-center rounded-full bg-[color:var(--color-surface-elevated)] text-[color:var(--color-blush-300)] shadow-[var(--shadow-soft)]"
        aria-hidden
      >
        <Gift className="h-6 w-6" strokeWidth={1.75} />
      </span>
      <header className="flex flex-col items-center gap-3 text-center">
        <span className="font-mono text-[10px] tracking-[0.32em] text-[color:var(--color-blush-300)] uppercase">
          {t('eyebrow')}
        </span>
        <h1
          className="font-display text-balance italic"
          style={{
            fontSize: 'clamp(1.875rem, 3.5vw, 2.5rem)',
            lineHeight: 1.05,
            letterSpacing: '-0.022em',
            color: 'var(--color-foreground)',
          }}
        >
          {isCouple ? t('titleCouple') : t('title', { months: invite.grantMonths })}
        </h1>
        <p className="text-sm leading-relaxed text-[color:var(--color-muted-foreground)] sm:text-base">
          {isCouple ? t('subtitleCouple') : t('subtitle', { months: invite.grantMonths })}
        </p>
        {/* Dit explicitement ce qui NE sera pas demandé : c'est la promesse
              du lien, et c'est ce qui décide quelqu'un à aller au bout. */}
        <p className="text-sm font-medium text-[color:var(--color-foreground)]">{t('noCard')}</p>
      </header>

      <div className="w-full rounded-3xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-7 shadow-[var(--shadow-soft)]">
        {session ? (
          <PartnerInviteForm
            token={token}
            defaultName={invite.inviteeName ?? ''}
            months={invite.grantMonths}
            kind={invite.kind}
          />
        ) : (
          <div className="flex flex-col gap-3">
            <Link
              href={`/sign-in?next=${encodeURIComponent(`/rejoindre/${token}`)}`}
              className="inline-flex h-11 items-center justify-center rounded-xl bg-[color:var(--color-brand-500)] px-5 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              {t('signInCta')}
            </Link>
            <p className="text-center text-xs text-[color:var(--color-muted-foreground)]">
              {t('signInHint')}
            </p>
          </div>
        )}
      </div>

      {invite.partnerCode ? (
        <p className="max-w-[46ch] text-center text-xs text-[color:var(--color-muted-foreground)]">
          {isCouple
            ? t('codeHintCouple', { code: invite.partnerCode })
            : t('codeHint', { code: invite.partnerCode })}
        </p>
      ) : null}
    </div>
  );
}
