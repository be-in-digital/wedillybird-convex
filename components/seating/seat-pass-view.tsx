import type { CSSProperties } from 'react';
import { getTranslations } from 'next-intl/server';
import { Calendar, MapPin } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { SeatPassCard } from '@/components/seating/seat-pass-card';
import { SeatPassQr } from '@/components/seating/seat-pass-qr';
import {
  SeatRoomPlan,
  type SeatRoomPlanElement,
  type SeatRoomPlanTable,
} from '@/components/seating/seat-room-plan';
import type { FloorKind } from '@/components/mon-mariage/seating-model';

/**
 * Corps du pass placement — séparé de la page pour la même raison
 * qu'`InvitationContent` : la route ne fait que lire Convex, tout le rendu
 * vit ici et se teste (ou se prévisualise) à partir de données seules.
 */

export type SeatPassStatus = 'ready' | 'unpublished' | 'not_attending' | 'unplaced';

export interface SeatPassViewData {
  status: SeatPassStatus;
  guest: { fullName: string; qrCodeToken: string; checkedInAt: number | null };
  event: {
    coupleNames: { partnerA: string; partnerB: string };
    eventDate: number;
    timezone: string;
    venue: { name: string; address: string } | null;
    theme: { primaryColor?: string } | null;
  };
  publication: { numbering: 'table' | 'seat'; note: string | null };
  members: Array<{
    memberIndex: number;
    fullName: string;
    tableName: string | null;
    tableId: string | null;
    seatNumber: number | null;
  }>;
  room: {
    name: string;
    widthM: number;
    lengthM: number;
    floor: FloorKind;
    elements: SeatRoomPlanElement[];
  } | null;
  tables: SeatRoomPlanTable[];
}

export async function SeatPassView({
  locale,
  token,
  data,
}: {
  locale: string;
  token: string;
  data: SeatPassViewData;
}) {
  const t = await getTranslations('SeatPass');
  const { guest, event, publication, members, room, tables, status } = data;

  const accentColor = event.theme?.primaryColor ?? 'oklch(72% 0.09 20)';
  const themeStyle = { '--invitation-accent': accentColor } as CSSProperties;
  const coupleNames = `${event.coupleNames.partnerA} & ${event.coupleNames.partnerB}`;
  const eventDateFormatted = new Intl.DateTimeFormat(locale, {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: event.timezone,
  }).format(new Date(event.eventDate));

  // Placement du porteur du lien : sa première ligne posée à une table.
  const mine = members.find((m) => m.tableName !== null) ?? null;

  return (
    <main
      className="paper-grain relative flex min-h-screen flex-col bg-[color:var(--color-ivory-50)]"
      style={themeStyle}
    >
      <article className="container-page mx-auto flex w-full max-w-xl flex-col gap-10 py-14 sm:py-20">
        <header className="flex flex-col items-center gap-4 text-center">
          <span className="font-mono text-[10px] tracking-[0.32em] text-[color:var(--color-ink-500)] uppercase">
            {t('eyebrow')}
          </span>
          <h1
            className="font-display text-balance italic"
            style={{
              fontSize: 'clamp(2rem, 5.5vw, 3rem)',
              lineHeight: 1.05,
              color: 'var(--color-ink-900)',
            }}
          >
            {coupleNames}
          </h1>
          <span
            aria-hidden
            className="inline-block h-px w-16"
            style={{ background: 'var(--invitation-accent)' }}
          />
          <p className="text-sm text-[color:var(--color-ink-700)]">
            {t('greeting', { name: guest.fullName })}
          </p>
        </header>

        {status === 'ready' ? (
          <>
            <SeatPassCard members={members} numbering={publication.numbering} />

            {publication.note ? (
              <aside className="rounded-2xl border border-dashed border-[color:var(--color-champagne-500)] bg-[color:var(--color-champagne-50)] px-5 py-4">
                <h2 className="font-mono text-[10px] tracking-[0.32em] text-[color:var(--color-ink-500)] uppercase">
                  {t('noteTitle')}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-[color:var(--color-ink-700)]">
                  {publication.note}
                </p>
              </aside>
            ) : null}

            {room && tables.length > 0 ? (
              <section className="flex flex-col gap-3">
                <h2 className="font-display text-xl text-[color:var(--color-ink-900)] italic">
                  {t('roomTitle')}
                </h2>
                <p className="text-sm text-[color:var(--color-ink-400)]">
                  {mine?.seatNumber != null
                    ? `${t('roomHint')} ${t('roomSeatHint')}`
                    : t('roomHint')}
                </p>
                <SeatRoomPlan
                  room={room}
                  tables={tables}
                  elements={room.elements}
                  highlight={{
                    tableId: mine?.tableId ?? null,
                    seatNumber: mine?.seatNumber ?? null,
                  }}
                />
              </section>
            ) : null}

            <section className="flex flex-col items-center gap-3 rounded-3xl border border-[color:var(--color-champagne-300)] bg-white/70 px-5 py-7">
              <h2 className="font-display text-xl text-[color:var(--color-ink-900)] italic">
                {t('qrTitle')}
              </h2>
              <p className="max-w-sm text-center text-sm text-[color:var(--color-ink-400)]">
                {t('qrHint')}
              </p>
              <SeatPassQr token={guest.qrCodeToken} guestName={guest.fullName} />
              {guest.checkedInAt ? (
                <p className="text-center text-sm text-[color:var(--color-sage-700)]">
                  <strong className="font-medium">{t('checkedInTitle')}</strong>
                  <br />
                  {t('checkedInAt', {
                    time: new Intl.DateTimeFormat(locale, {
                      timeStyle: 'short',
                      timeZone: event.timezone,
                    }).format(new Date(guest.checkedInAt)),
                  })}
                </p>
              ) : null}
            </section>
          </>
        ) : (
          <StatusPanel status={status} token={token} />
        )}

        {/* Rappel des essentiels : l'invité ouvre souvent ce lien en chemin. */}
        <section className="flex flex-col gap-3 text-sm text-[color:var(--color-ink-700)]">
          <p className="flex items-start gap-2">
            <Calendar className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.5} aria-hidden />
            <span>{eventDateFormatted}</span>
          </p>
          {event.venue ? (
            <p className="flex items-start gap-2">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.5} aria-hidden />
              <span>
                {event.venue.name}
                <br />
                <span className="text-[color:var(--color-ink-400)]">{event.venue.address}</span>
              </span>
            </p>
          ) : null}
        </section>

        <footer className="flex justify-center">
          <Link
            href={`/i/${token}`}
            className="font-mono text-[11px] tracking-[0.2em] text-[color:var(--color-ink-500)] uppercase underline underline-offset-4 hover:text-[color:var(--color-ink-900)]"
          >
            {t('backToInvitation')}
          </Link>
        </footer>
      </article>
    </main>
  );
}

/**
 * États non-« ready » : plan pas encore publié, invité non confirmé, ou tablée
 * pas encore placée. On explique et on garde le lien valable plutôt que de
 * renvoyer un 404 anxiogène la veille d'un mariage.
 */
async function StatusPanel({
  status,
  token,
}: {
  status: 'unpublished' | 'not_attending' | 'unplaced';
  token: string;
}) {
  const t = await getTranslations('SeatPass');
  const copy = {
    unpublished: { title: t('unpublishedTitle'), body: t('unpublishedBody') },
    not_attending: { title: t('notAttendingTitle'), body: t('notAttendingBody') },
    unplaced: { title: t('unplacedTitle'), body: t('unplacedBody') },
  }[status];

  return (
    <section className="flex flex-col items-center gap-4 rounded-3xl border border-dashed border-[color:var(--color-champagne-500)] bg-[color:var(--color-champagne-50)] px-6 py-10 text-center">
      <h2 className="font-display text-2xl text-[color:var(--color-ink-900)] italic">
        {copy.title}
      </h2>
      <p className="max-w-sm text-sm leading-relaxed text-[color:var(--color-ink-700)]">
        {copy.body}
      </p>
      {status === 'not_attending' ? (
        <Link
          href={`/i/${token}`}
          className="rounded-full border border-[color:var(--color-champagne-700)] px-5 py-2 font-mono text-[11px] tracking-[0.2em] text-[color:var(--color-ink-900)] uppercase"
        >
          {t('notAttendingCta')}
        </Link>
      ) : null}
    </section>
  );
}
