'use client';

/* Tableau de bord partenaire : le lien à partager, les ventes attribuées et
   ce qui reste dû. Le lien `?ref=CODE` est LA surface d'attribution (le proxy
   pose le cookie `wdb_ref` au premier clic) — d'où sa mise en avant : un code
   simplement recopié ailleurs ne rattache la vente que s'il est aussi saisi au
   checkout comme code promo. */

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Check, Copy, Link2 } from 'lucide-react';

type ReferralStatus = 'pending' | 'vested' | 'paid' | 'credited' | 'reversed';

interface PartnerCode {
  code: string;
  rateBps: number;
  buyerDiscountBps: number;
  status: 'active' | 'disabled';
  displayName: string | null;
  /**
   * Le code est-il saisissable au checkout (code promo Stripe créé) ? Faux =
   * on n'affiche QUE le lien : inviter à partager un code que le checkout
   * refuserait ferait passer la partenaire pour une menteuse auprès de son
   * audience.
   */
  shareable: boolean;
}

interface PartnerReferral {
  id: string;
  code: string;
  status: ReferralStatus;
  rewardMinor: number;
  netMinor: number;
  currency: string;
  vestsAt: number;
  createdAt: number;
}

interface PartnerTotal {
  currency: string;
  status: ReferralStatus;
  minor: number;
}

export function PartnerDashboard({
  codes,
  referrals,
  totals,
  salesCount,
}: {
  codes: PartnerCode[];
  referrals: PartnerReferral[];
  totals: PartnerTotal[];
  salesCount: number;
}) {
  const t = useTranslations('Partner');
  const format = useFormatter();

  const money = (minor: number, currency: string) =>
    format.number(minor / 100, { style: 'currency', currency });

  // « Dû » = acquis mais pas encore versé. `pending` reste en attente tant que
  // le mariage n'a pas eu lieu (fenêtre de remboursement) — les deux sont
  // affichés séparément pour ne jamais laisser croire qu'un montant est payable
  // alors qu'il ne l'est pas encore.
  const vested = totals.filter((x) => x.status === 'vested');
  const pending = totals.filter((x) => x.status === 'pending');
  const settled = totals.filter((x) => x.status === 'paid' || x.status === 'credited');

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-4">
        <h2 className="font-mono text-[10px] tracking-[0.24em] text-[color:var(--color-ink-500)] uppercase">
          {t('linkTitle')}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {codes.map((c) => (
            <CodeCard key={c.code} code={c} />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-mono text-[10px] tracking-[0.24em] text-[color:var(--color-ink-500)] uppercase">
          {t('earningsTitle')}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label={t('statSales')} value={String(salesCount)} />
          <Stat
            label={t('statVested')}
            value={vested.length ? vested.map((x) => money(x.minor, x.currency)).join(' · ') : '—'}
            hint={t('statVestedHint')}
          />
          <Stat
            label={t('statPending')}
            value={
              pending.length ? pending.map((x) => money(x.minor, x.currency)).join(' · ') : '—'
            }
            hint={t('statPendingHint')}
          />
          <Stat
            label={t('statPaid')}
            value={
              settled.length ? settled.map((x) => money(x.minor, x.currency)).join(' · ') : '—'
            }
          />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-mono text-[10px] tracking-[0.24em] text-[color:var(--color-ink-500)] uppercase">
          {t('ledgerTitle')}
        </h2>
        <div className="overflow-x-auto rounded-xl border border-[color:var(--color-border)]">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-[color:var(--color-surface)] text-left font-mono text-[10px] tracking-[0.16em] text-[color:var(--color-ink-500)] uppercase">
              <tr>
                <th className="px-4 py-2.5">{t('colDate')}</th>
                <th className="px-4 py-2.5">{t('colCode')}</th>
                <th className="px-4 py-2.5">{t('colReward')}</th>
                <th className="px-4 py-2.5">{t('colStatus')}</th>
              </tr>
            </thead>
            <tbody>
              {referrals.map((r) => (
                <tr key={r.id} className="border-t border-[color:var(--color-border)]">
                  <td className="px-4 py-2.5 text-[color:var(--color-ink-500)]">
                    {format.dateTime(new Date(r.createdAt), { dateStyle: 'medium' })}
                  </td>
                  <td className="px-4 py-2.5 font-mono">{r.code}</td>
                  <td className="px-4 py-2.5 font-medium">{money(r.rewardMinor, r.currency)}</td>
                  <td className="px-4 py-2.5">{t(`status.${r.status}`)}</td>
                </tr>
              ))}
              {referrals.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-10 text-center text-sm text-[color:var(--color-ink-500)]"
                  >
                    {t('ledgerEmpty')}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <p className="max-w-[70ch] text-xs leading-relaxed text-[color:var(--color-ink-500)]">
          {t('payoutNote')}
        </p>
      </section>
    </div>
  );
}

function CodeCard({ code }: { code: PartnerCode }) {
  const t = useTranslations('Partner');

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://wedillybird.com';
  const link = `${origin}/?ref=${code.code}`;

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-5">
      <div className="flex items-center gap-2">
        <Link2
          className="h-4 w-4 text-[color:var(--color-gold-700)]"
          strokeWidth={1.9}
          aria-hidden
        />
        <span className="font-mono text-sm font-medium">{code.code}</span>
        {code.status === 'disabled' ? (
          <span className="font-mono text-[10px] tracking-[0.16em] text-[color:var(--color-ink-500)] uppercase">
            {t('codeDisabled')}
          </span>
        ) : null}
      </div>
      <p className="text-xs text-[color:var(--color-ink-500)]">
        {code.buyerDiscountBps > 0
          ? t('codeTermsWithDiscount', {
              rate: code.rateBps / 100,
              discount: code.buyerDiscountBps / 100,
            })
          : t('codeTerms', { rate: code.rateBps / 100 })}
      </p>

      <CopyField label={t('linkLabel')} value={link} hint={t('linkHint')} />

      {/* Le code ne s'affiche que s'il est réellement accepté au checkout. */}
      {code.shareable ? (
        <CopyField label={t('codeLabel')} value={code.code} hint={t('codeHint')} />
      ) : null}
    </div>
  );
}

/** Champ en lecture seule + bouton copier, avec sa légende d'usage. */
function CopyField({ label, value, hint }: { label: string; value: string; hint: string }) {
  const t = useTranslations('Partner');
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard indisponible — le champ reste sélectionnable à la main.
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-mono text-[10px] tracking-[0.16em] text-[color:var(--color-ink-500)] uppercase">
        {label}
      </span>
      <div className="flex items-center gap-2">
        <input
          readOnly
          value={value}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-3 py-2 font-mono text-xs"
          aria-label={label}
        />
        <button
          type="button"
          onClick={copy}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[color:var(--color-border)] px-3 py-2 text-xs font-medium transition-colors hover:bg-[color:var(--color-surface-elevated)]"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          ) : (
            <Copy className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          )}
          {copied ? t('copied') : t('copy')}
        </button>
      </div>
      <span className="text-xs text-[color:var(--color-ink-500)]">{hint}</span>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-5">
      <span className="font-mono text-[10px] tracking-[0.16em] text-[color:var(--color-ink-500)] uppercase">
        {label}
      </span>
      <span className="text-lg font-medium text-[color:var(--color-ink-900)]">{value}</span>
      {hint ? <span className="text-xs text-[color:var(--color-ink-500)]">{hint}</span> : null}
    </div>
  );
}
