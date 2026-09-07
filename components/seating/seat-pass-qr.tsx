import { getTranslations } from 'next-intl/server';
import { qrSvgData } from '@/lib/qr/matrix';

/**
 * QR code d'entrée de l'invité, rendu en SVG côté serveur.
 *
 * Encode le `qrCodeToken` **nu** — exactement ce que le scanner de check-in
 * transmet à `guests.checkInByToken`. Le code s'affiche donc sur le pass sans
 * dépendre d'un service tiers ni d'un aller-retour réseau le jour J, et le
 * token est répété en clair dessous pour la saisie manuelle quand la caméra
 * peine (lumière tamisée, écran fissuré).
 *
 * Niveau de correction M (~15 % de redondance) : marge confortable sur un
 * écran de téléphone, sans gonfler la version du QR.
 */
export async function SeatPassQr({ token, guestName }: { token: string; guestName: string }) {
  const t = await getTranslations('SeatPass');
  const qr = qrSvgData(token, 'M');

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="rounded-2xl border border-[color:var(--color-champagne-300)] bg-white p-3 shadow-sm">
        <svg
          viewBox={qr.viewBox}
          className="block h-auto w-44 sm:w-52"
          shapeRendering="crispEdges"
          role="img"
          aria-label={t('qrAlt', { name: guestName })}
        >
          <path d={qr.path} fill="var(--color-ink-900)" />
        </svg>
      </div>
      <p className="text-center font-mono text-sm tracking-[0.22em] text-[color:var(--color-ink-700)]">
        {token}
      </p>
    </div>
  );
}
