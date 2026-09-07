import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getSession } from '@/lib/auth/session';
import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';
import { ProSidebarShell } from '@/components/pro/pro-sidebar-shell';
import { SettingsShell } from '@/components/pro/settings-shell';
import { effectiveProTier } from '@/lib/payments/entitlements';

const DEFAULT_PRIMARY = '#2c1a11';
const DEFAULT_ACCENT = '#c8a165';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('ProPages');
  return { title: t('settingsMetaTitle') };
}

/**
 * /pro/settings — page de réglages de l'organisation pro.
 *
 * Pour le moment elle ne contient que le branding (logo + couleurs). On
 * pourra y ajouter d'autres sections plus tard (préférences notifications,
 * domaine custom, etc.) sans changer la route.
 *
 * Pattern auth/Convex aligné sur `/pro/billing` :
 *  - session HMAC requise (sinon redirect /sign-in)
 *  - org doit exister (sinon redirect /pro/onboarding)
 *  - on précharge `myOrganization` pour pré-remplir les inputs et afficher
 *    la preview du logo via l'URL signée Convex (`logoUrl`).
 */
export default async function ProSettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('ProPages');

  const session = await getSession();
  if (!session) redirect({ href: '/sign-in', locale });

  const convex = getConvexServerClient();
  const org = await convex.query(convexApi.myOrganization, { userId: session!.userId });
  if (!org) redirect({ href: '/pro/onboarding', locale });

  const user = await convex.query(convexApi.currentUser, { userId: session!.userId });
  const members =
    org!.myRole === 'owner'
      ? await convex.query(convexApi.listOrgMembers, {
          organizationId: org!._id,
          requesterId: session!.userId,
        })
      : [];

  // Couleurs : on assure un format hex 6-digit pour les inputs natifs (ils
  // n'acceptent pas la forme courte). Si l'orga a une valeur invalide
  // historique, on retombe sur le default.
  const isHex6 = (value: string | undefined): value is string =>
    !!value && /^#[0-9a-fA-F]{6}$/.test(value);
  const initialPrimary = isHex6(org!.primaryColor) ? org!.primaryColor : DEFAULT_PRIMARY;
  const initialAccent = isHex6(org!.accentColor) ? org!.accentColor : DEFAULT_ACCENT;

  return (
    <ProSidebarShell
      current="settings"
      org={{
        name: org!.name,
        primaryColor: org!.primaryColor,
        tier: effectiveProTier(org!),
        role: org!.myRole,
      }}
      user={{ name: user?.fullName }}
    >
      <div className="container-page mx-auto flex max-w-5xl flex-col gap-8 py-8 sm:py-10">
        <header className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] tracking-[0.32em] text-[color:var(--color-muted-foreground)] uppercase">
            {t('settingsEyebrow')}
          </span>
          <h1
            className="font-display text-balance italic"
            style={{
              fontSize: 'clamp(1.9rem, 4vw, 2.75rem)',
              lineHeight: 1.05,
              letterSpacing: '-0.022em',
              color: 'var(--color-foreground)',
            }}
          >
            {t('settingsTitle')}
          </h1>
        </header>

        <SettingsShell
          org={{
            name: org!.name,
            slug: org!.slug,
            tier: effectiveProTier(org!),
            role: org!.myRole,
          }}
          user={{ name: user?.fullName, email: user?.email }}
          branding={{
            logoUrl: org!.logoUrl,
            primaryColor: initialPrimary,
            accentColor: initialAccent,
          }}
          whiteLabel={{
            customDomain: org!.customDomain ?? '',
            senderEmail: org!.senderEmail ?? '',
            whiteLabelFull: org!.whiteLabelFull,
          }}
          notifPrefs={org!.notificationPrefs}
          messagingDefaults={org!.messagingDefaults}
          members={members}
        />
      </div>
    </ProSidebarShell>
  );
}
