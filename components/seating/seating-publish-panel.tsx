'use client';

import { useState, useTransition } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { AlertTriangle, Check, Send, ListOrdered, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  autoNumberSeatsAction,
  broadcastSeatPassesAction,
  setSeatingPublicationAction,
} from '@/app/[locale]/(app)/events/[eventId]/seating/actions';
import type { SeatingNotifications, SeatingPlan, SeatingPublication } from '@/lib/seating/board';

/**
 * Panneau « numéroter → publier → envoyer » du plan de table.
 *
 * Il matérialise l'étape de **validation** demandée par le produit : le plan
 * reste invisible des invités tant que l'organisateur n'a pas publié, et
 * l'envoi des pass est refusé côté serveur avant publication. Les deux gestes
 * sont donc volontairement distincts, dans cet ordre.
 *
 * Les compteurs (doublons de chaise, personnes sans numéro, invités à
 * prévenir) sortent de `getSeatingPlan` : ce sont les seuls signaux qui
 * empêchent d'envoyer un plan faux à 200 personnes.
 */
export function SeatingPublishPanel({
  eventId,
  publication,
  notifications,
  stats,
  onPlanRefreshed,
}: {
  eventId: string;
  publication: SeatingPublication;
  notifications: SeatingNotifications;
  stats: { seatConflicts: number; unnumbered: number };
  onPlanRefreshed: (plan: SeatingPlan) => void;
}) {
  const t = useTranslations('Seating');
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState(publication.note ?? '');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Enchaîne : action serveur → remplacement du plan par la vérité serveur →
   * message. Toutes les actions du panneau renvoient le plan rafraîchi, car
   * numéroter ou publier peut déplacer d'autres personnes (échange de chaise).
   */
  function apply<R extends { ok: true; plan: SeatingPlan } | { ok: false; error: string }>(
    run: () => Promise<R>,
    message?: (result: Extract<R, { ok: true }>) => string,
  ): void {
    setError(null);
    setFeedback(null);
    startTransition(async () => {
      const result = await run();
      if (!result.ok) {
        setError(result.error === 'SEATING_NOT_PUBLISHED' ? t('notifyNotPublished') : t('error'));
        return;
      }
      const success = result as Extract<R, { ok: true }>;
      onPlanRefreshed(success.plan);
      if (message) setFeedback(message(success));
    });
  }

  const savePublication = (patch: Partial<SeatingPublication> & { published: boolean }) =>
    apply(() =>
      setSeatingPublicationAction(eventId, {
        published: patch.published,
        numbering: patch.numbering ?? publication.numbering,
        showRoomPlan: patch.showRoomPlan ?? publication.showRoomPlan,
        note: patch.note ?? note,
      }),
    );

  return (
    <section
      className="flex flex-col gap-5 rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-5"
      data-testid="seating-publish-panel"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-semibold text-[color:var(--color-ink-900)]">
            {t('publishTitle')}
          </h2>
          <p className="max-w-xl text-xs leading-relaxed text-[color:var(--color-ink-500)]">
            {t('publishHint')}
          </p>
        </div>
        <span
          data-testid="publish-badge"
          data-published={publication.published}
          className={`rounded-full px-3 py-1 font-mono text-[10px] tracking-[0.2em] uppercase ${
            publication.published
              ? 'bg-[color:var(--color-sage-100)] text-[color:var(--color-sage-700)]'
              : 'bg-[color:var(--color-ivory-200)] text-[color:var(--color-ink-500)]'
          }`}
        >
          {publication.published ? t('publishedBadge') : t('draftBadge')}
        </span>
      </header>

      {/* 1. Numérotation des chaises */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          data-testid="auto-number"
          onClick={() =>
            apply(
              () => autoNumberSeatsAction(eventId, 'fill'),
              (res) => t('autoNumberDone', { count: res.numbered }),
            )
          }
        >
          <ListOrdered className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          {t('autoNumber')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          data-testid="renumber"
          onClick={() => {
            if (!window.confirm(t('renumberConfirm'))) return;
            apply(() => autoNumberSeatsAction(eventId, 'renumber'));
          }}
        >
          {t('renumber')}
        </Button>
      </div>

      {/* Signaux bloquants — visibles avant publication, pas après coup */}
      {stats.seatConflicts > 0 ? (
        <p
          className="flex items-center gap-2 text-xs text-[color:var(--color-danger)]"
          data-testid="seat-conflict-warning"
        >
          <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          {t('seatConflictWarning', { count: stats.seatConflicts })}
        </p>
      ) : null}
      {stats.unnumbered > 0 && publication.numbering === 'seat' ? (
        <p className="text-xs text-[color:var(--color-ink-500)]" data-testid="unnumbered-warning">
          {t('unnumberedWarning', { count: stats.unnumbered })}
        </p>
      ) : null}

      {/* 2. Réglages de ce que voit l'invité */}
      <fieldset className="flex flex-col gap-3">
        <legend className="font-mono text-[10px] tracking-[0.2em] text-[color:var(--color-ink-500)] uppercase">
          {t('numberingTitle')}
        </legend>
        <div className="flex flex-wrap gap-2">
          {(['seat', 'table'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              disabled={pending}
              data-testid={`numbering-${mode}`}
              aria-pressed={publication.numbering === mode}
              onClick={() => savePublication({ published: publication.published, numbering: mode })}
              className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                publication.numbering === mode
                  ? 'border-[color:var(--color-accent)] bg-[color:var(--color-accent)]/10 text-[color:var(--color-ink-900)]'
                  : 'border-[color:var(--color-border)] text-[color:var(--color-ink-500)]'
              }`}
            >
              {mode === 'seat' ? t('numberingSeat') : t('numberingTable')}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-[color:var(--color-ink-700)]">
          <input
            type="checkbox"
            checked={publication.showRoomPlan}
            disabled={pending}
            data-testid="show-room-plan"
            onChange={(e) =>
              savePublication({
                published: publication.published,
                showRoomPlan: e.target.checked,
              })
            }
          />
          {t('showRoomPlan')}
        </label>
        <label className="flex flex-col gap-1 text-xs text-[color:var(--color-ink-700)]">
          {t('noteLabel')}
          <Input
            value={note}
            maxLength={280}
            disabled={pending}
            placeholder={t('notePlaceholder')}
            data-testid="seating-note"
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => {
              if ((publication.note ?? '') === note) return;
              savePublication({ published: publication.published, note });
            }}
          />
        </label>
      </fieldset>

      {/* 3. Publication puis envoi */}
      <div className="flex flex-wrap items-center gap-2 border-t border-[color:var(--color-border)] pt-4">
        <Button
          type="button"
          variant={publication.published ? 'ghost' : 'primary'}
          size="sm"
          disabled={pending}
          data-testid="toggle-publish"
          onClick={() => savePublication({ published: !publication.published })}
        >
          {publication.published ? (
            t('unpublishCta')
          ) : (
            <>
              <Check className="h-4 w-4" strokeWidth={1.75} aria-hidden />
              {t('publishCta')}
            </>
          )}
        </Button>

        <Button
          type="button"
          variant="primary"
          size="sm"
          data-testid="send-seat-passes"
          disabled={pending || !publication.published || notifications.needsNotify === 0}
          onClick={() =>
            apply(
              () => broadcastSeatPassesAction(eventId),
              (res) =>
                [
                  t('notifyDone', { sent: res.sent }),
                  res.failed > 0 ? t('notifyFailed', { count: res.failed }) : null,
                  res.skipped > 0 ? t('notifySkipped', { count: res.skipped }) : null,
                ]
                  .filter(Boolean)
                  .join(' · '),
            )
          }
        >
          <Send className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          {t('notifyCta', { count: notifications.needsNotify })}
        </Button>

        {publication.published && notifications.notified > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            data-testid="resend-seat-passes"
            onClick={() => {
              if (!window.confirm(t('notifyForceConfirm'))) return;
              apply(
                () => broadcastSeatPassesAction(eventId, true),
                (res) => t('notifyDone', { sent: res.sent }),
              );
            }}
          >
            {t('notifyForce')}
          </Button>
        ) : null}
      </div>

      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[color:var(--color-ink-500)]">
        <span data-testid="notified-count">
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
        <span className="inline-flex items-center gap-1">
          <Eye className="h-3 w-3" strokeWidth={1.75} aria-hidden />
          {t('notifyHint')}
        </span>
      </p>

      {feedback ? (
        <p className="text-xs text-[color:var(--color-sage-700)]" data-testid="publish-feedback">
          {feedback}
        </p>
      ) : null}
      {error ? (
        <p className="text-xs text-[color:var(--color-danger)]" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
