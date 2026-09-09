'use client';
/* Wedillybird — Espace couple · Écran 2 — Dashboard du mariage (vue de travail)
   Aéré, tactile. Header · RSVP (donut+fill bar) · jauges de quota · invités
   (ajout rapide + recherche/filtre) · invitation publique (lien+QR) · rétroplanning. */

import { useState, useMemo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { COUNTRIES, FR } from '@/lib/phone-countries';
import { Icon, Mark } from './icons';
import { McBtn, Fleuron, CoupleNames, McPill, RsvpDonut, QuotaGauge, QrMono } from './parts';
import {
  mcJ,
  mcDateLong,
  mcDateShort,
  mcNum,
  mcGo,
  mcGuestStatusMeta,
  mcInitials,
  type McCouple,
  type McRsvp,
  type McUsage,
  type McActive,
  type McGuest,
  type McStep,
} from './data';
import { useRouter } from '@/i18n/navigation';
import { rsvpFromGuests } from '@/lib/mon-mariage/adapt';
import { useMonMariage } from '@/stores/mon-mariage';
import { InvitationDesignModal } from './invitation-design-modal';

/** Libellé « J− » localisé depuis le descripteur de `mcJ`. */
function useJLabel(iso: string): string {
  const tc = useTranslations('MonMariage.common');
  const now = useMonMariage((st) => st.now);
  const j = mcJ(iso, now || undefined);
  return j.kind === 'day'
    ? tc('jDay')
    : j.kind === 'before'
      ? tc('jBefore', { n: j.n })
      : tc('jAfter', { n: j.n });
}

/* ---------- header ---------- */
function DashHeader({ couple }: { couple: McCouple; expected: number }) {
  const locale = useLocale();
  const jLabel = useJLabel(couple.weddingDate);
  return (
    <header className="mc-dashhead">
      <div className="top">
        <h1 className="names">
          <CoupleNames names={couple.names} />
        </h1>
        <span className="mc-jchip" style={{ marginBottom: 4 }}>
          <Icon name="Clock" size={12} stroke={2.1} />
          {jLabel}
        </span>
      </div>
      <div className="meta">
        <span className="dt">{mcDateLong(couple.weddingDate, locale)}</span>
        <span className="vn">
          <Icon name="MapPin" size={13} stroke={1.8} />
          {couple.venue}
        </span>
      </div>
    </header>
  );
}

/* ---------- RSVP ---------- */
function RsvpCard({ rsvp, cap }: { rsvp: McRsvp; cap: number }) {
  const t = useTranslations('MonMariage.dashboard');
  const legend: ReadonlyArray<[string, string, number]> = [
    ['var(--color-sage-500)', t('legend.confirmed'), rsvp.confirmed],
    ['var(--color-blush-400)', t('legend.pending'), rsvp.pending],
    ['var(--color-danger)', t('legend.declined'), rsvp.declined],
    ['var(--color-border-strong)', t('legend.noreply'), rsvp.noreply],
  ];
  const okPct = (rsvp.expected / cap) * 100;
  const waitGuests = Math.round(rsvp.pending * 1.4); // estimation personnes en attente
  return (
    <section className="mc-card">
      <div className="mc-sec-head">
        <h2 className="mc-sec-title">{t('rsvpTitle')}</h2>
        <Fleuron size={13} />
      </div>
      <div className="mc-rsvp">
        <div className="mc-rsvp-top">
          <RsvpDonut
            confirmed={rsvp.confirmed}
            pending={rsvp.pending}
            declined={rsvp.declined}
            noreply={rsvp.noreply}
          />
          <div className="mc-rsvp-legend">
            {legend.map(([c, n, v]) => (
              <div className="mc-rsvp-leg" key={n}>
                <span className="dot" style={{ background: c }} />
                <span className="nm">{n}</span>
                <span className="vv">{v}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="mc-fillbar">
          <div className="lab">
            <span className="l">{t('expectedPeople')}</span>
            <span className="r">
              {rsvp.expected} / {cap}
            </span>
          </div>
          <div className="track">
            <i className="seg-ok" style={{ width: Math.min(100, okPct) + '%' }} />
            <i
              className="seg-wait"
              style={{ width: Math.min(100 - okPct, (waitGuests / cap) * 100) + '%' }}
            />
          </div>
          <span className="cap">
            <Icon name="Users" size={12} stroke={1.9} />
            {t('planCapacity', { cap })}
          </span>
        </div>
      </div>
    </section>
  );
}

/* ---------- jauges de quota ---------- */
function QuotaCard({ usage, active }: { usage: McUsage; active: McActive }) {
  const t = useTranslations('MonMariage.dashboard');
  const locale = useLocale();
  return (
    <section className="mc-card">
      <div className="mc-sec-head">
        <h2 className="mc-sec-title">{t('quotasTitle')}</h2>
        <span className="mc-pill gold">
          <span className="d" />
          {t('galleryActive')}
        </span>
      </div>
      <div className="mc-quotas" style={{ marginTop: 14 }}>
        <QuotaGauge
          icon="Users"
          label={t('quotaGuests')}
          sub={t('quotaGuestsSub')}
          used={usage.guests}
          cap={active.guestCap}
          fmt={(n) => mcNum(n, locale)}
        />
        <QuotaGauge
          icon="HardDrive"
          label={t('quotaStorage')}
          sub={t('quotaStorageSub')}
          used={usage.storageGo}
          cap={active.storageCap}
          fmt={(n) => mcGo(n, locale)}
          gold
        />
      </div>
    </section>
  );
}

/* ---------- invités ---------- */
// libellés via clés `MonMariage.dashboard.filters.<k>`
const MC_FILTERS: ReadonlyArray<[string, string]> = [
  ['all', 'all'],
  ['confirmed', 'confirmed'],
  ['pending', 'pending'],
  ['noreply', 'noreply'],
  ['declined', 'declined'],
];

function GuestRow({ g }: { g: McGuest }) {
  const tRoot = useTranslations('MonMariage');
  const [kind, labelKey] = mcGuestStatusMeta(g.status);
  return (
    <div className="mc-guest">
      <span className="gav">{mcInitials(g.name)}</span>
      <div className="gn">
        <b>{g.name}</b>
        <span className="gm">
          <span>{g.group}</span>
          <span className="wa">
            <Icon name="MessageCircle" size={11} stroke={2} />
            {g.cc} {g.phone}
          </span>
        </span>
      </div>
      {g.count > 1 && (
        <span className="gc">
          <Icon name="Users" size={12} stroke={1.9} />
          {g.count}
        </span>
      )}
      <McPill kind={kind}>{tRoot(labelKey.replace(/^MonMariage\./, ''))}</McPill>
    </div>
  );
}

function GuestsCard({ guests }: { guests: McGuest[] }) {
  const t = useTranslations('MonMariage.dashboard');
  const addGuest = useMonMariage((st) => st.addGuest);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  // L'indicatif était figé à `+1` : tout invité ajouté ici repartait avec un
  // numéro américain, quel que soit son pays. Il se choisit désormais.
  const [dial, setDial] = useState(FR.dial);
  const list = guests;

  const add = () => {
    if (!name.trim()) return;
    void addGuest({
      fullName: name.trim(),
      ...(phone.trim() ? { phone: `+${dial} ${phone.trim()}` } : {}),
      plusOnesAllowed: 0,
    });
    setName('');
    setPhone('');
  };
  const country = COUNTRIES.find((c) => c.dial === dial) ?? FR;
  const shown = useMemo(
    () =>
      list.filter(
        (g) =>
          (filter === 'all' || g.status === filter) &&
          (!q.trim() ||
            g.name.toLowerCase().includes(q.toLowerCase()) ||
            g.group.toLowerCase().includes(q.toLowerCase())),
      ),
    [list, filter, q],
  );

  return (
    <section className="mc-card">
      <div className="mc-sec-head">
        <div>
          <h2 className="mc-sec-title">{t('guestListTitle')}</h2>
          <p className="mc-sec-sub">
            {t('guestListSub', {
              invitations: list.length,
              people: list.reduce((a, g) => a + g.count, 0),
            })}
          </p>
        </div>
        <span className="mc-pill ok">
          <span className="d" />
          {t('confirmedCount', { count: list.filter((g) => g.status === 'confirmed').length })}
        </span>
      </div>

      {/* ajout rapide */}
      <div className="mc-quickadd" style={{ marginTop: 14 }}>
        <div className="mc-qa-field">
          <Icon name="Users" size={16} stroke={1.8} />
          <input
            value={name}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
            onKeyDown={(e: React.KeyboardEvent) => e.key === 'Enter' && add()}
            placeholder={t('guestNamePlaceholder')}
            aria-label={t('nameAria')}
          />
        </div>
        <div className="mc-qa-phone">
          <span className="cc">
            <Icon name="MessageCircle" size={13} stroke={2} className="wa" />
            <select
              value={dial}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setDial(e.target.value)}
              aria-label={t('countryCodeAria')}
            >
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.dial}>
                  {c.flag} +{c.dial}
                </option>
              ))}
            </select>
          </span>
          <input
            value={phone}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPhone(e.target.value)}
            onKeyDown={(e: React.KeyboardEvent) => e.key === 'Enter' && add()}
            inputMode="tel"
            placeholder={country.placeholder}
            aria-label={t('whatsappAria')}
          />
        </div>
        <McBtn variant="primary" size="md" onClick={add}>
          <Icon name="Plus" size={16} stroke={2.2} />
          {t('add')}
        </McBtn>
      </div>

      {/* recherche + filtre */}
      <div className="mc-guests-bar" style={{ marginTop: 14 }}>
        <div className="mc-search">
          <Icon name="Search" size={16} stroke={1.9} />
          <input
            value={q}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQ(e.target.value)}
            placeholder={t('searchGuest')}
            aria-label={t('searchAria')}
          />
        </div>
        <div className="mc-filters" role="group" aria-label={t('filterAria')}>
          {MC_FILTERS.map(([k, l]) => (
            <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
              {t(`filters.${l}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="mc-guests" style={{ marginTop: 12 }}>
        {shown.length ? (
          shown.map((g) => <GuestRow key={g.id} g={g} />)
        ) : (
          <div className="mc-guest-empty">{t('noGuestMatch')}</div>
        )}
      </div>
    </section>
  );
}

/* ---------- invitation publique ---------- */
function InviteCard({ couple, eventId }: { couple: McCouple; eventId: string }) {
  const t = useTranslations('MonMariage.dashboard');
  const locale = useLocale();
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const previewPath = `/events/${eventId}/preview`;
  const url = `wedillybird.com/${couple.slug}`;
  const copy = () => {
    const absolute =
      typeof window !== 'undefined'
        ? `${window.location.origin}/${locale}${previewPath}`
        : previewPath;
    void navigator.clipboard?.writeText(absolute).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <section className="mc-card">
      <div className="mc-sec-head">
        <h2 className="mc-sec-title">{t('inviteTitle')}</h2>
        <span
          className="mc-pill brand"
          style={{ background: 'var(--brand-soft)', color: 'var(--brand-strong)' }}
        >
          <span className="d" style={{ background: 'var(--brand)' }} />
          {t('online')}
        </span>
      </div>
      <div className="mc-invite" style={{ marginTop: 14 }}>
        <div className="mc-invite-row">
          <div className="mc-invite-prev" aria-hidden="true">
            <span className="eb">{t('youAreInvited')}</span>
            <span className="mk">
              <Mark size={20} />
            </span>
            <span className="nn">
              {(couple.names.split('&')[0] ?? '').trim()}
              <span className="amp">&amp;</span>
              {(couple.names.split('&')[1] ?? '').trim()}
            </span>
            <span className="dd">{mcDateShort(couple.weddingDate, locale)}</span>
          </div>
          <div className="mc-invite-info">
            <div className="mc-linkbox">
              <span className="lk">
                <Icon name="Link" size={14} stroke={1.9} />
                {url}
              </span>
              <button className={'cp' + (copied ? ' done' : '')} onClick={copy}>
                {copied ? (
                  <>
                    <Icon name="Check" size={14} stroke={2.4} />
                    {t('copied')}
                  </>
                ) : (
                  <>
                    <Icon name="Copy" size={14} stroke={1.9} />
                    {t('copy')}
                  </>
                )}
              </button>
            </div>
            <div className="mc-invite-actions">
              <McBtn variant="soft" size="sm" onClick={copy}>
                <Icon name="Share2" size={15} stroke={1.9} />
                {t('shareWhatsApp')}
              </McBtn>
              <McBtn variant="outline" size="sm" onClick={() => router.push(previewPath)}>
                <Icon name="Eye" size={15} stroke={1.9} />
                {t('preview')}
              </McBtn>
              <McBtn variant="outline" size="sm" onClick={() => setCustomizing(true)}>
                <Icon name="Wand2" size={15} stroke={1.9} />
                {t('customize')}
              </McBtn>
            </div>
          </div>
        </div>
        <div className="mc-invite-qr">
          <span className="mc-qr">
            <QrMono seed={couple.slug} />
          </span>
          <div className="qx">
            <b>{t('qrTitle')}</b>
            <span>{t('qrDesc')}</span>
          </div>
        </div>
      </div>
      {customizing && (
        <InvitationDesignModal
          eventId={eventId}
          previewPath={previewPath}
          onClose={() => setCustomizing(false)}
        />
      )}
    </section>
  );
}

/* ---------- rétroplanning léger ---------- */
function PlanCard({ steps }: { steps: McStep[] }) {
  const t = useTranslations('MonMariage.dashboard');
  const tRoot = useTranslations('MonMariage');
  const tr = (key: string) => tRoot(key.replace(/^MonMariage\./, ''));
  return (
    <section className="mc-card">
      <div className="mc-sec-head">
        <h2 className="mc-sec-title">{t('planTitle')}</h2>
        <Fleuron size={13} />
      </div>
      <div className="mc-plan" style={{ marginTop: 14 }}>
        {steps.map((s) => (
          <div
            key={s.id}
            className={'mc-step' + (s.done ? ' done' : '') + (s.current ? ' current' : '')}
          >
            <span className="mc-step-dot">
              {s.done ? (
                <Icon name="Check" size={14} stroke={2.6} />
              ) : s.current ? (
                <span
                  style={{ width: 7, height: 7, borderRadius: '50%', background: 'currentColor' }}
                />
              ) : null}
            </span>
            <div className="mc-step-body">
              <div className="st">
                <b>{tr(s.label)}</b>
                <span className="wh">{tr(s.when)}</span>
              </div>
              {s.note ? <p>{tr(s.note)}</p> : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function DashScreen({ guests }: { guests: McGuest[] }) {
  const couple = useMonMariage((st) => st.couple);
  const active = useMonMariage((st) => st.active);
  const usage = useMonMariage((st) => st.usage);
  const event = useMonMariage((st) => st.event);
  const phases = useMonMariage((st) => st.phases);
  const rawGuests = useMonMariage((st) => st.guests);
  const rsvp = useMemo(() => rsvpFromGuests(rawGuests), [rawGuests]);

  // Rétroplanning léger : dérivé des phases réelles (label/sub = clés ou libres).
  const steps: McStep[] = useMemo(
    () =>
      phases.map((ph) => {
        const done = ph.tasks.length > 0 && ph.tasks.every((tk) => tk.status === 'done');
        return {
          id: ph.id,
          label: ph.label,
          when: ph.sub,
          ...(done ? { done: true } : {}),
          ...(ph.current ? { current: true } : {}),
          note: '',
        };
      }),
    [phases],
  );

  if (!couple || !event) return null;
  const cap = active?.guestCap ?? event.maxGuests;

  return (
    <>
      <DashHeader couple={couple} expected={rsvp.expected} />
      <div className="mc-grid2">
        <RsvpCard rsvp={rsvp} cap={cap} />
        {active ? <QuotaCard usage={usage} active={active} /> : null}
      </div>
      <GuestsCard guests={guests} />
      <div className="mc-grid2">
        <InviteCard couple={couple} eventId={event.id} />
        <PlanCard steps={steps} />
      </div>
    </>
  );
}
