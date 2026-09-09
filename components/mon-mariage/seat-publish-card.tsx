'use client';

import { useState, useTransition } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useMonMariage } from '@/stores/mon-mariage';
import { Icon } from './icons';

/**
 * « Numéroter → publier → envoyer » côté couple (/mon-mariage).
 *
 * Même contrat que le panneau agence (`components/seating/seating-publish-panel`)
 * mais dans la papeterie de l'espace couple : le plan reste invisible des
 * invités tant que le couple n'a pas publié, et l'envoi des pass est refusé
 * côté serveur avant publication.
 *
 * Toutes les écritures passent par le store, qui recharge le bundle : les
 * numéros sont calculés côté serveur (avec échanges de chaises possibles), un
 * patch local divergerait.
 */
export function SeatPublishCard() {
  const t = useTranslations('Seating');
  const locale = useLocale();
  const event = useMonMariage((s) => s.event);
  const guests = useMonMariage((s) => s.guests);
  const notifications = useMonMariage((s) => s.seatingNotifications);
  const autoNumberSeats = useMonMariage((s) => s.autoNumberSeats);
  const setSeatingPublication = useMonMariage((s) => s.setSeatingPublication);
  const broadcastSeatPasses = useMonMariage((s) => s.broadcastSeatPasses);

  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);
  const publication = event?.seatingPublication;
  const [note, setNote] = useState(publication?.note ?? '');

  if (!event || !publication) return null;

  const unnumbered = guests.filter((g) => g.tableId !== null && g.seatNumber === null).length;
  const run = (fn: () => Promise<string | null>) => {
    setFeedback(null);
    startTransition(async () => setFeedback(await fn()));
  };

  const save = (patch: {
    published?: boolean;
    numbering?: 'table' | 'seat';
    showRoomPlan?: boolean;
    note?: string;
  }) =>
    run(async () => {
      await setSeatingPublication({
        published: patch.published ?? publication.published,
        numbering: patch.numbering ?? publication.numbering,
        showRoomPlan: patch.showRoomPlan ?? publication.showRoomPlan,
        note: patch.note ?? note,
      });
      return null;
    });

  return (
    <section className="mc-card anim" style={{ display: 'grid', gap: 16 }}>
      <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
        <span className="mc-eyebrow" style={{ flex: 1 }}>
          {t('publishTitle')}
        </span>
        <span className={`mc-pill ${publication.published ? 'ok' : 'wait'}`}>
          <span className="d" />
          {publication.published ? t('publishedBadge') : t('draftBadge')}
        </span>
      </header>

      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: 'var(--color-ink-500)' }}>
        {t('publishHint')}
      </p>

      {/* 1. Numérotation */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button
          type="button"
          className="mc-btn sm outline"
          disabled={pending}
          data-testid="mm-auto-number"
          onClick={() =>
            run(async () => {
              const numbered = await autoNumberSeats('fill');
              return t('autoNumberDone', { count: numbered });
            })
          }
        >
          <Icon name="ListChecks" size={14} stroke={1.9} />
          {t('autoNumber')}
        </button>
        <button
          type="button"
          className="mc-btn ghost sm"
          disabled={pending}
          data-testid="mm-renumber"
          onClick={() => {
            if (!window.confirm(t('renumberConfirm'))) return;
            run(async () => {
              await autoNumberSeats('renumber');
              return null;
            });
          }}
        >
          {t('renumber')}
        </button>
      </div>

      {unnumbered > 0 && publication.numbering === 'seat' ? (
        <p
          style={{ margin: 0, fontSize: 12, color: 'var(--color-ink-500)' }}
          data-testid="mm-unnumbered"
        >
          {t('unnumberedWarning', { count: unnumbered })}
        </p>
      ) : null}

      {/* 2. Ce que voit l'invité */}
      <div style={{ display: 'grid', gap: 10 }}>
        <span className="mc-eyebrow">{t('numberingTitle')}</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {(['seat', 'table'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              disabled={pending}
              aria-pressed={publication.numbering === mode}
              data-testid={`mm-numbering-${mode}`}
              className={`mc-btn sm ${publication.numbering === mode ? 'primary' : 'outline'}`}
              onClick={() => save({ numbering: mode })}
            >
              {mode === 'seat' ? t('numberingSeat') : t('numberingTable')}
            </button>
          ))}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={publication.showRoomPlan}
            disabled={pending}
            data-testid="mm-show-room-plan"
            onChange={(e) => save({ showRoomPlan: e.target.checked })}
          />
          {t('showRoomPlan')}
        </label>
        <label className="mc-fld">
          <span>{t('noteLabel')}</span>
          <input
            className="mc-inp"
            value={note}
            maxLength={280}
            disabled={pending}
            placeholder={t('notePlaceholder')}
            data-testid="mm-seating-note"
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => {
              if ((publication.note ?? '') === note) return;
              save({ note });
            }}
          />
        </label>
      </div>

      {/* 3. Publier puis envoyer */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          borderTop: '1px solid var(--color-champagne-200)',
          paddingTop: 14,
        }}
      >
        <button
          type="button"
          disabled={pending}
          data-testid="mm-toggle-publish"
          className={`mc-btn sm ${publication.published ? 'ghost' : 'primary'}`}
          onClick={() => save({ published: !publication.published })}
        >
          {publication.published ? null : <Icon name="Check" size={14} stroke={2.1} />}
          {publication.published ? t('unpublishCta') : t('publishCta')}
        </button>
        <button
          type="button"
          className="mc-btn primary sm"
          data-testid="mm-send-seat-passes"
          disabled={pending || !publication.published || notifications.needsNotify === 0}
          onClick={() =>
            run(async () => {
              const res = await broadcastSeatPasses();
              if (!res) return null;
              return [
                t('notifyDone', { sent: res.sent }),
                res.failed > 0 ? t('notifyFailed', { count: res.failed }) : null,
              ]
                .filter(Boolean)
                .join(' · ');
            })
          }
        >
          <Icon name="Send" size={14} stroke={1.9} />
          {t('notifyCta', { count: notifications.needsNotify })}
        </button>
        {publication.published && notifications.notified > 0 ? (
          <button
            type="button"
            className="mc-btn ghost sm"
            disabled={pending}
            data-testid="mm-resend-seat-passes"
            onClick={() => {
              if (!window.confirm(t('notifyForceConfirm'))) return;
              run(async () => {
                const res = await broadcastSeatPasses(true);
                return res ? t('notifyDone', { sent: res.sent }) : null;
              });
            }}
          >
            {t('notifyForce')}
          </button>
        ) : null}
      </div>

      <p
        style={{
          margin: 0,
          display: 'flex',
          flexWrap: 'wrap',
          gap: '4px 14px',
          fontSize: 12,
          color: 'var(--color-ink-500)',
        }}
      >
        <span data-testid="mm-notified-count">
          {t('notifiedCount', {
            notified: notifications.notified,
            total: notifications.placedGuests,
          })}
        </span>
        {publication.published && publication.publishedAt ? (
          <span>
            {t('publishedAt', {
              date: new Intl.DateTimeFormat(locale, {
                dateStyle: 'medium',
                timeStyle: 'short',
              }).format(new Date(publication.publishedAt)),
            })}
          </span>
        ) : null}
        <span>{t('notifyHint')}</span>
      </p>

      {feedback ? (
        <p
          style={{ margin: 0, fontSize: 12, color: 'var(--color-sage-700)' }}
          data-testid="mm-publish-feedback"
        >
          {feedback}
        </p>
      ) : null}
    </section>
  );
}
