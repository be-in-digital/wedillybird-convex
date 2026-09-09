import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { convexApi, getConvexServerClient } from '@/lib/auth/convex-server';
import { SeatPassView, type SeatPassViewData } from '@/components/seating/seat-pass-view';
import { TrackOnMount } from '@/components/analytics/track-on-mount';

/**
 * Pass placement de l'invité — `/{locale}/i/{token}/place`.
 *
 * Même token que l'invitation et que le QR de check-in : l'invité n'a qu'un
 * seul lien à conserver, et le code qu'il présente à l'entrée porte déjà sa
 * place (le scanner l'affiche à l'hôtesse).
 *
 * La route ne fait que lire Convex ; tout le rendu vit dans `SeatPassView`.
 *
 * Le cache est court plutôt que `force-dynamic` : la page peut être ouverte en
 * rafale à l'arrivée des convives, mais un remaniement de dernière minute doit
 * se voir vite. 30 s est le compromis retenu (idem page invitation).
 */
export const revalidate = 30;

/** Page nominative : `noindex` strict, comme l'invitation. */
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false, noimageindex: true },
  },
};

export default async function SeatPassPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);

  const convex = getConvexServerClient();
  const data = await convex.query(convexApi.getSeatPassByToken, { token });
  if (!data) notFound();

  return (
    <>
      <TrackOnMount event="seat_pass_viewed" properties={{ status: data.status }} />
      <SeatPassView locale={locale} token={token} data={data as SeatPassViewData} />
    </>
  );
}
