import { getTranslations } from 'next-intl/server';
import { Calendar, MapPin, Camera } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import type { RsvpConfig } from '@/lib/rsvp/questions';
import { WeddingCountdown } from './wedding-countdown';
import { RsvpFormV4 } from './rsvp-form-v4';
import { Reveal } from './reveal';
import { LandingFooterRich } from '@/components/landing/footer-rich';

interface InvitationContentProps {
  token: string;
  locale: string;
  accentColor: string;
  /** Afficher le footer marque Wedillybird (page publique) — masqué en marque blanche. */
  showFooter?: boolean;
  /**
   * Page `/demo` : RSVP simulé (aucune écriture) et pas de lien galerie —
   * il n'existe pas de galerie fictive et un lien mort casserait la démo.
   */
  demo?: boolean;
  guest: {
    fullName: string;
    plusOnesAllowed: number;
    rsvpStatus: 'pending' | 'attending' | 'declined' | 'maybe';
    plusOnesNames?: string[];
    dietaryRestrictions?: string;
    notes?: string;
    customAnswers?: Array<{ questionId: string; values: string[] }>;
  };
  event: {
    coupleNames: { partnerA: string; partnerB: string };
    eventDate: number;
    timezone: string;
    venue?: { name: string; address: string };
    rsvpConfig?: RsvpConfig | null;
  };
}

const EYEBROW =
  'font-mono text-[10px] tracking-[0.32em] text-[color:var(--color-ink-500)] uppercase';

/**
 * Corps de la page d'invitation — partagé entre la page publique
 * (`/i/[token]`) et la version marque blanche (`/orgs/[slug]/i/[token]`).
 * Auparavant dupliqué (et non traduit côté orga) ; désormais une seule source,
 * entièrement localisée. Direction « mariage éditorial » (cf. DESIGN.md) :
 * monogramme gold, filets fleuron entre sections, RSVP en pièce maîtresse.
 */
export async function InvitationContent({
  token,
  locale,
  accentColor,
  showFooter = false,
  demo = false,
  guest,
  event,
}: InvitationContentProps) {
  const t = await getTranslations('Invitation');

  const eventDateFormatted = new Intl.DateTimeFormat(locale, {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: event.timezone,
  }).format(new Date(event.eventDate));

  const initials = (event.coupleNames.partnerA[0] ?? '') + (event.coupleNames.partnerB[0] ?? '');

  return (
    <>
      <article className="container-page mx-auto flex w-full max-w-2xl flex-col gap-14 py-16 sm:gap-16 sm:py-24">
        {/* Header couple */}
        <Reveal>
          <header className="flex flex-col items-center gap-5 text-center">
            <span
              aria-hidden
              className="font-display flex h-14 w-14 items-center justify-center rounded-full border text-lg italic"
              style={{
                borderColor: 'var(--invitation-accent)',
                color: 'var(--invitation-accent)',
                letterSpacing: '0.02em',
              }}
            >
              {initials.toUpperCase()}
            </span>
            <span className={EYEBROW}>{t('youreInvited')}</span>
            <h1
              className="font-display text-balance italic"
              style={{
                fontSize: 'clamp(2.75rem, 7vw, 4.5rem)',
                lineHeight: 1,
                letterSpacing: '-0.025em',
                color: 'var(--color-ink-900)',
              }}
            >
              {event.coupleNames.partnerA}
              <br />
              <span
                className="not-italic"
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: '0.4em',
                  fontWeight: 300,
                  letterSpacing: '0.4em',
                  color: 'var(--invitation-accent)',
                  display: 'inline-block',
                  margin: '0.25em 0',
                }}
              >
                &amp;
              </span>
              <br />
              {event.coupleNames.partnerB}
            </h1>
            <span
              aria-hidden
              className="my-1 inline-block h-px w-16"
              style={{ background: 'var(--invitation-accent)' }}
            />
            <p className="text-base leading-relaxed text-[color:var(--color-ink-700)] sm:text-lg">
              {t('addressing', { name: guest.fullName })}
            </p>
          </header>
        </Reveal>

        <Ornament />

        {/* Countdown live */}
        <Reveal>
          <section className="flex flex-col items-center gap-5">
            <span className={EYEBROW}>{t('countdownLabel')}</span>
            <WeddingCountdown eventDate={event.eventDate} accentColor={accentColor} />
          </section>
        </Reveal>

        {/* Détails — date + lieu */}
        <Reveal>
          <section className="paper-grain flex flex-col gap-6 rounded-3xl border border-[color:var(--color-border)] bg-white p-8 shadow-[var(--shadow-soft)]">
            <div className="flex items-start gap-4">
              <IconChip>
                <Calendar className="h-4 w-4" strokeWidth={1.75} />
              </IconChip>
              <div className="flex flex-col gap-1">
                <span className={EYEBROW}>{t('dateAndTime')}</span>
                <p className="text-base text-[color:var(--color-ink-900)] sm:text-lg">
                  {eventDateFormatted}
                </p>
              </div>
            </div>

            {event.venue ? (
              <div className="flex items-start gap-4 border-t border-[color:var(--color-border)] pt-6">
                <IconChip>
                  <MapPin className="h-4 w-4" strokeWidth={1.75} />
                </IconChip>
                <div className="flex flex-col gap-1">
                  <span className={EYEBROW}>{t('venue')}</span>
                  <p className="text-base font-medium text-[color:var(--color-ink-900)] sm:text-lg">
                    {event.venue.name}
                  </p>
                  <p className="text-sm text-[color:var(--color-ink-500)]">{event.venue.address}</p>
                </div>
              </div>
            ) : null}
          </section>
        </Reveal>

        <Ornament />

        {/* RSVP — pièce maîtresse */}
        <Reveal>
          <section className="flex flex-col gap-6">
            <header className="flex flex-col items-center gap-3 text-center">
              <span className={EYEBROW}>{t('yourReply')}</span>
              <p
                className="font-display text-balance italic"
                style={{
                  fontSize: 'clamp(1.5rem, 3vw, 2.25rem)',
                  lineHeight: 1.15,
                  letterSpacing: '-0.02em',
                  color: 'var(--color-ink-900)',
                }}
              >
                {t('rsvpPrompt')}
              </p>
            </header>
            <RsvpFormV4
              token={token}
              plusOnesAllowed={guest.plusOnesAllowed}
              accentColor={accentColor}
              config={event.rsvpConfig}
              mode={demo ? 'demo' : 'live'}
              initial={{
                rsvpStatus: guest.rsvpStatus,
                plusOnesNames: guest.plusOnesNames,
                dietaryRestrictions: guest.dietaryRestrictions,
                notes: guest.notes,
                customAnswers: guest.customAnswers,
              }}
            />
          </section>
        </Reveal>

        {/* Lien galerie — absent en démo (pas de galerie fictive) */}
        {demo ? null : (
          <Reveal>
            <Link
              href={`/i/${token}/gallery`}
              className="focus-ring group flex items-center justify-between gap-4 rounded-2xl border border-[color:var(--color-border)] bg-white px-6 py-5 transition-all hover:border-[color:var(--color-border-strong)] hover:shadow-[var(--shadow-soft)]"
            >
              <span className="flex items-center gap-3">
                <IconChip>
                  <Camera className="h-4 w-4" strokeWidth={1.75} />
                </IconChip>
                <span className="flex flex-col">
                  <span className="text-base font-medium text-[color:var(--color-ink-900)]">
                    {t('openGallery')}
                  </span>
                  <span className={EYEBROW}>{t('galleryHint')}</span>
                </span>
              </span>
              <span
                aria-hidden
                className="text-lg text-[color:var(--color-ink-500)] transition-transform group-hover:translate-x-1"
              >
                →
              </span>
            </Link>
          </Reveal>
        )}
      </article>
      {showFooter ? <LandingFooterRich /> : null}
    </>
  );
}

/** Filet fleuron gold entre deux sections (cf. DESIGN.md §8). */
function Ornament() {
  return (
    <div className="ornament-divider" aria-hidden>
      <span style={{ fontSize: '0.85rem' }}>✦</span>
    </div>
  );
}

/** Pastille icône teintée à la couleur d'accent du couple. */
function IconChip({ children }: { children: React.ReactNode }) {
  return (
    <span
      aria-hidden
      className="mt-1 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl text-white"
      style={{ background: 'var(--invitation-accent)' }}
    >
      {children}
    </span>
  );
}
