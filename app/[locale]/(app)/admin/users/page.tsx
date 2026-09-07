import { setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getSession } from '@/lib/auth/session';
import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';
import { AdminShell } from '@/components/admin/admin-shell';
import { AdminUsersTable } from '@/components/admin/admin-users-table';

export default async function AdminUsersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await getSession();
  if (!session) redirect({ href: '/sign-in', locale });

  const convex = getConvexServerClient();
  const [user, users, affiliates] = await Promise.all([
    convex.query(convexApi.currentUser, { userId: session!.userId }),
    convex.query(convexApi.adminListUsers, { adminId: session!.userId }),
    convex.query(convexApi.listAffiliates, { adminId: session!.userId }),
  ]);
  // Codes partenaire encore sans compte rattaché : c'est ce qu'on peut relier
  // depuis cette page. Le parrainage particulier est exclu — il est créé PAR le
  // compte du parrain, il ne se rattache pas à la main.
  const attachablePartnerCodes = affiliates
    .filter((a) => a.kind === 'partner')
    .map((a) => ({ id: a.id, code: a.code, displayName: a.displayName, ownerEmail: a.ownerEmail }));

  return (
    <AdminShell current="users" adminName={user?.fullName}>
      <div className="flex flex-col gap-6">
        <header>
          <h1
            className="font-display italic"
            style={{
              fontSize: 'clamp(1.5rem, 3vw, 2rem)',
              lineHeight: 1.1,
              letterSpacing: '-0.022em',
            }}
          >
            Utilisateurs
          </h1>
          <p className="mt-1 text-sm text-[color:var(--color-muted-foreground)]">
            {users.length} utilisateurs enregistrés
          </p>
        </header>
        <AdminUsersTable users={users} partnerCodes={attachablePartnerCodes} />
      </div>
    </AdminShell>
  );
}
