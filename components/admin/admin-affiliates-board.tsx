'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Handshake, Loader2, Plus } from 'lucide-react';
import {
  adminCreateAffiliateAction,
  adminCreatePartnerInviteAction,
  adminEnsureAffiliateCouponAction,
  adminMarkReferralPaidAction,
  adminRevokePartnerInviteAction,
  adminSendPartnerInviteAction,
  adminSetAffiliateStatusAction,
} from '@/app/[locale]/(app)/admin/actions';

interface Affiliate {
  id: string;
  code: string;
  kind: 'referral' | 'partner';
  rewardType: 'credit' | 'cash';
  rateBps: number;
  buyerDiscountBps: number;
  ownerEmail: string | null;
  displayName: string | null;
  status: 'active' | 'disabled';
  /** Code réellement saisissable au checkout (code promo Stripe créé). */
  shareCode: string | null;
  stripePromotionCodeId: string | null;
  createdAt: number;
}

interface PartnerInvite {
  id: string;
  affiliateId: string;
  /** Rendu uniquement tant que le lien sert — jamais pour un lien mort. */
  token: string | null;
  state: 'usable' | 'consumed' | 'revoked' | 'expired';
  inviteeEmail: string | null;
  inviteeName: string | null;
  grantTier: 'starter' | 'business' | 'agency';
  grantMonths: number;
  expiresAt: number;
  consumedAt: number | null;
  createdAt: number;
  /** Dernier envoi réussi — dit à l'admin s'il doit envoyer ou relancer. */
  lastSentAt: number | null;
  lastSentTo: string | null;
  sendCount: number;
}

interface Referral {
  id: string;
  affiliateId: string;
  code: string;
  status: 'pending' | 'vested' | 'paid' | 'credited' | 'reversed';
  rewardType: 'credit' | 'cash';
  rewardMinor: number;
  netMinor: number;
  commissionBaseMinor: number | null;
  currency: string;
  vestsAt: number;
  createdAt: number;
}

// Miroir de MAX_COMBINED_BPS (convex/lib/affiliate.ts) — garde-fou marge côté UI.
const MAX_COMBINED_BPS = 2500;

const STATUS_LABEL: Record<Referral['status'], string> = {
  pending: 'En attente',
  vested: 'Acquis',
  paid: 'Payé',
  credited: 'Crédité',
  reversed: 'Annulé',
};

function fmtMinor(minor: number, currency: string): string {
  return `${(minor / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} ${currency}`;
}

const INVITE_STATE_LABEL: Record<PartnerInvite['state'], string> = {
  usable: 'Lien actif',
  consumed: 'Compte ouvert',
  revoked: 'Annulé',
  expired: 'Expiré',
};

export function AdminAffiliatesBoard({
  affiliates,
  referrals,
  invites = [],
}: {
  affiliates: Affiliate[];
  referrals: Referral[];
  invites?: PartnerInvite[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  /** Adresse effectivement servie par le dernier envoi, pour confirmation. */
  const [sent, setSent] = useState<string | null>(null);

  const [code, setCode] = useState('');
  const [kind, setKind] = useState<'referral' | 'partner'>('partner');
  const [rewardType, setRewardType] = useState<'credit' | 'cash'>('cash');
  const [ratePct, setRatePct] = useState(20);
  const [discountPct, setDiscountPct] = useState(0);
  const [ownerEmail, setOwnerEmail] = useState('');
  const [displayName, setDisplayName] = useState('');

  const combinedBps = Math.round(ratePct * 100) + Math.round(discountPct * 100);
  const overCap = combinedBps > MAX_COMBINED_BPS;
  const codeValid = /^[A-Za-z0-9]{3,24}$/.test(code.trim());

  function onKindChange(next: 'referral' | 'partner') {
    setKind(next);
    // Défaut cohérent : parrainage = crédit (100 % auto), partenaire = cash.
    setRewardType(next === 'referral' ? 'credit' : 'cash');
  }

  function create() {
    setError(null);
    if (!codeValid || overCap) return;
    startTransition(async () => {
      const res = await adminCreateAffiliateAction({
        code: code.trim(),
        kind,
        rewardType,
        rateBps: Math.round(ratePct * 100),
        buyerDiscountBps: Math.round(discountPct * 100),
        ...(ownerEmail.trim() ? { ownerEmail: ownerEmail.trim() } : {}),
        ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // Affilié créé mais coupon Stripe en échec : le lien attribue déjà, seul
      // le code saisissable manque. On le dit plutôt que d'afficher un succès
      // qui laisserait croire que le code est partageable.
      if (res.couponError) {
        setError(
          `Affilié créé, mais code promo Stripe NON créé (${res.couponError}). Relance « Créer le code ».`,
        );
      }
      setCode('');
      setOwnerEmail('');
      setDisplayName('');
      router.refresh();
    });
  }

  function toggle(a: Affiliate) {
    startTransition(async () => {
      await adminSetAffiliateStatusAction(a.id, a.status === 'active' ? 'disabled' : 'active');
      router.refresh();
    });
  }

  /**
   * Rattrapage : crée le code promo Stripe d'un affilié qui n'en a pas encore
   * (échec réseau à la création, ou affilié ouvert avant que la création
   * automatique n'existe).
   */
  function ensureCoupon(a: Affiliate) {
    setError(null);
    startTransition(async () => {
      const res = await adminEnsureAffiliateCouponAction(a.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  /**
   * Versement d'une commission acquise. Le virement lui-même est manuel (hors
   * app) ; ce bouton acte le versement dans le ledger — sans lui, une
   * commission `vested` restait due indéfiniment, aucune sortie de statut
   * n'étant exposée au back-office.
   */
  function markPaid(r: Referral) {
    setError(null);
    const reference = window.prompt(
      `Marquer ${fmtMinor(r.rewardMinor, r.currency)} (${r.code}) comme versé.\n\nRéférence du virement (facultatif) :`,
      '',
    );
    if (reference === null) return;
    startTransition(async () => {
      const res = await adminMarkReferralPaidAction(r.id, reference.trim() || undefined);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  // Agrégats du ledger : somme par (devise, statut) pour les récompenses dues.
  /**
   * Le lien le plus récent de chaque partenaire. Un seul lien vit à la fois
   * (Convex révoque le précédent à la création), donc afficher le dernier
   * suffit — et évite un historique qui n'aide personne dans un tableau.
   */
  const latestInvite = useMemo(() => {
    const map = new Map<string, PartnerInvite>();
    for (const inv of invites) {
      const current = map.get(inv.affiliateId);
      if (!current || inv.createdAt > current.createdAt) map.set(inv.affiliateId, inv);
    }
    return map;
  }, [invites]);

  /** Lien d'invitation complet, tel qu'on le copie pour l'envoyer. */
  function inviteUrl(token: string): string {
    const origin = typeof window === 'undefined' ? '' : window.location.origin;
    return `${origin}/rejoindre/${token}`;
  }

  function createInvite(a: Affiliate) {
    setError(null);
    startTransition(async () => {
      const res = await adminCreatePartnerInviteAction(a.id, {
        ...(a.ownerEmail ? { inviteeEmail: a.ownerEmail } : {}),
        ...(a.displayName ? { inviteeName: a.displayName } : {}),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  /**
   * Envoie le lien au partenaire. `sent` porte l'adresse réellement servie —
   * le destinataire est résolu côté serveur, pas ici : afficher l'adresse
   * qu'on croyait viser plutôt que celle atteinte serait un faux témoignage.
   */
  function sendInvite(inviteId: string) {
    setError(null);
    setSent(null);
    startTransition(async () => {
      const res = await adminSendPartnerInviteAction(inviteId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSent(res.to ?? null);
      router.refresh();
    });
  }

  function revokeInvite(inviteId: string) {
    setError(null);
    startTransition(async () => {
      const res = await adminRevokePartnerInviteAction(inviteId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  const totals = useMemo(() => {
    const map = new Map<string, { currency: string; status: Referral['status']; minor: number }>();
    for (const r of referrals) {
      if (r.status === 'pending' || r.status === 'vested') {
        const key = `${r.currency}:${r.status}`;
        const prev = map.get(key);
        map.set(key, {
          currency: r.currency,
          status: r.status,
          minor: (prev?.minor ?? 0) + r.rewardMinor,
        });
      }
    }
    return [...map.values()];
  }, [referrals]);

  const inputCls =
    'h-9 w-full rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-2.5 text-sm text-[color:var(--color-foreground)] focus:outline-none focus:ring-1 focus:ring-[color:var(--color-primary)]';
  const labelCls =
    'mb-1 block font-mono text-[10px] tracking-[0.2em] text-[color:var(--color-ink-500)] uppercase';

  return (
    <div className="flex flex-col gap-8 p-8">
      <header className="flex items-center gap-3">
        <Handshake
          className="h-5 w-5 text-[color:var(--color-accent)]"
          strokeWidth={1.8}
          aria-hidden
        />
        <div>
          <h1 className="font-display text-2xl italic">Affiliation</h1>
          <p className="text-sm text-[color:var(--color-ink-500)]">
            Affiliés sur invitation. Parrainage particulier = crédit (auto) ; partenaire = cash
            (payout groupé, acquis à la date de l&apos;event).
          </p>
        </div>
      </header>

      {/* Création */}
      <section className="rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-5">
        <h2 className="mb-4 text-sm font-semibold">Nouvel affilié</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div className="col-span-2 sm:col-span-1">
            <label className={labelCls}>Code</label>
            <input
              className={inputCls}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="NORAH10"
            />
          </div>
          <div>
            <label className={labelCls}>Type</label>
            <select
              className={inputCls}
              value={kind}
              onChange={(e) => onKindChange(e.target.value as 'referral' | 'partner')}
            >
              <option value="partner">Partenaire</option>
              <option value="referral">Parrainage</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Récompense</label>
            <select
              className={inputCls}
              value={rewardType}
              onChange={(e) => setRewardType(e.target.value as 'credit' | 'cash')}
            >
              <option value="cash">Cash</option>
              <option value="credit">Crédit</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Commission %</label>
            <input
              type="number"
              min={0}
              max={25}
              className={inputCls}
              value={ratePct}
              onChange={(e) => setRatePct(Number(e.target.value))}
            />
          </div>
          <div>
            <label className={labelCls}>Remise filleul %</label>
            <input
              type="number"
              min={0}
              max={25}
              className={inputCls}
              value={discountPct}
              onChange={(e) => setDiscountPct(Number(e.target.value))}
            />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className={labelCls}>Email (payout)</label>
            <input
              className={inputCls}
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
              placeholder="norah@…"
            />
          </div>
          <div className="col-span-2 sm:col-span-2">
            <label className={labelCls}>Nom affiché</label>
            <input
              className={inputCls}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Norah — @norah"
            />
          </div>
        </div>
        <div className="mt-4 flex items-center gap-4">
          <button
            type="button"
            onClick={create}
            disabled={pending || !codeValid || overCap}
            className="inline-flex items-center gap-2 rounded-md bg-[color:var(--color-primary)] px-4 py-2 text-sm font-medium text-[color:var(--color-primary-foreground)] disabled:opacity-50"
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden />
            ) : (
              <Plus className="h-4 w-4" strokeWidth={2} aria-hidden />
            )}
            Créer
          </button>
          {overCap ? (
            <span className="text-sm text-[color:var(--color-destructive)]">
              Commission + remise dépassent 25 % — casse la marge Essentiel.
            </span>
          ) : null}
          {error ? (
            <span className="text-sm text-[color:var(--color-destructive)]">{error}</span>
          ) : null}
          {sent ? (
            <span className="text-sm text-[color:var(--color-accent)]">
              Invitation envoyée à {sent}.
            </span>
          ) : null}
        </div>
      </section>

      {/* Ledger — totaux dus */}
      {totals.length > 0 ? (
        <section className="flex flex-wrap gap-3">
          {totals.map((t) => (
            <div
              key={`${t.currency}:${t.status}`}
              className="rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 py-3"
            >
              <div className="font-mono text-[10px] tracking-[0.2em] text-[color:var(--color-ink-500)] uppercase">
                {STATUS_LABEL[t.status]} · {t.currency}
              </div>
              <div className="text-lg font-semibold">{fmtMinor(t.minor, t.currency)}</div>
            </div>
          ))}
        </section>
      ) : null}

      {/* Affiliés */}
      <section>
        <h2 className="mb-3 text-sm font-semibold">Affiliés ({affiliates.length})</h2>
        <div className="overflow-x-auto rounded-xl border border-[color:var(--color-border)]">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-[color:var(--color-surface)] text-left font-mono text-[10px] tracking-[0.16em] text-[color:var(--color-ink-500)] uppercase">
              <tr>
                <th className="px-4 py-2.5">Code</th>
                <th className="px-4 py-2.5">Type</th>
                <th className="px-4 py-2.5">Récompense</th>
                <th className="px-4 py-2.5">Comm. / Remise</th>
                <th className="px-4 py-2.5">Code partageable</th>
                <th className="px-4 py-2.5">Contact</th>
                <th className="px-4 py-2.5">Compte offert</th>
                <th className="px-4 py-2.5">Statut</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {affiliates.map((a) => (
                <tr key={a.id} className="border-t border-[color:var(--color-border)]">
                  <td className="px-4 py-2.5 font-mono font-medium">{a.code}</td>
                  <td className="px-4 py-2.5">
                    {a.kind === 'referral' ? 'Parrainage' : 'Partenaire'}
                  </td>
                  <td className="px-4 py-2.5">{a.rewardType === 'credit' ? 'Crédit' : 'Cash'}</td>
                  <td className="px-4 py-2.5">
                    {a.rateBps / 100}% / {a.buyerDiscountBps / 100}%
                  </td>
                  <td className="px-4 py-2.5">
                    {a.shareCode ? (
                      <span className="font-mono">{a.shareCode}</span>
                    ) : a.buyerDiscountBps > 0 ? (
                      <button
                        type="button"
                        onClick={() => ensureCoupon(a)}
                        disabled={pending}
                        className="rounded-md border border-[color:var(--color-border)] px-2 py-1 text-xs disabled:opacity-50"
                      >
                        Créer le code
                      </button>
                    ) : (
                      <span
                        className="text-[color:var(--color-ink-500)]"
                        title="Sans remise filleul, il n'y a rien à faire taper au checkout — seul le lien attribue."
                      >
                        lien seul
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-[color:var(--color-ink-500)]">
                    {a.displayName ?? a.ownerEmail ?? '—'}
                  </td>
                  {/* Le lien d'invitation n'a de sens que pour un partenaire :
                      le parrainage particulier n'ouvre pas de compte agence. */}
                  <td className="px-4 py-2.5">
                    {a.kind !== 'partner' ? (
                      <span className="text-[color:var(--color-ink-500)]">—</span>
                    ) : (
                      <PartnerInviteCell
                        invite={latestInvite.get(a.id) ?? null}
                        pending={pending}
                        onCreate={() => createInvite(a)}
                        onRevoke={revokeInvite}
                        onSend={sendInvite}
                        fallbackEmail={a.ownerEmail ?? null}
                        buildUrl={inviteUrl}
                      />
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={
                        a.status === 'active'
                          ? 'text-[color:var(--color-accent)]'
                          : 'text-[color:var(--color-ink-500)]'
                      }
                    >
                      {a.status === 'active' ? 'Actif' : 'Désactivé'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() => toggle(a)}
                      disabled={pending}
                      className="rounded-md border border-[color:var(--color-border)] px-2.5 py-1 text-xs disabled:opacity-50"
                    >
                      {a.status === 'active' ? 'Désactiver' : 'Réactiver'}
                    </button>
                  </td>
                </tr>
              ))}
              {affiliates.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-8 text-center text-sm text-[color:var(--color-ink-500)]"
                  >
                    Aucun affilié. Créez-en un ci-dessus (invitation-only).
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {/* Ledger détaillé */}
      <section>
        <h2 className="mb-3 text-sm font-semibold">Ledger ({referrals.length})</h2>
        <div className="overflow-x-auto rounded-xl border border-[color:var(--color-border)]">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-[color:var(--color-surface)] text-left font-mono text-[10px] tracking-[0.16em] text-[color:var(--color-ink-500)] uppercase">
              <tr>
                <th className="px-4 py-2.5">Code</th>
                <th className="px-4 py-2.5">Vente (net)</th>
                <th className="px-4 py-2.5">Assiette HT</th>
                <th className="px-4 py-2.5">Récompense</th>
                <th className="px-4 py-2.5">Statut</th>
                <th className="px-4 py-2.5">Acquis le</th>
                <th className="px-4 py-2.5">Versement</th>
              </tr>
            </thead>
            <tbody>
              {referrals.map((r) => (
                <tr key={r.id} className="border-t border-[color:var(--color-border)]">
                  <td className="px-4 py-2.5 font-mono">{r.code}</td>
                  <td className="px-4 py-2.5">{fmtMinor(r.netMinor, r.currency)}</td>
                  {/* Ce sur quoi la commission a réellement été calculée : c'est
                      ici qu'on tranche un litige sur un montant. */}
                  <td className="px-4 py-2.5 text-[color:var(--color-ink-500)]">
                    {r.commissionBaseMinor === null
                      ? '—'
                      : fmtMinor(r.commissionBaseMinor, r.currency)}
                  </td>
                  <td className="px-4 py-2.5 font-medium">
                    {fmtMinor(r.rewardMinor, r.currency)}
                    <span className="ml-1 text-[color:var(--color-ink-500)]">
                      ({r.rewardType === 'credit' ? 'crédit' : 'cash'})
                    </span>
                  </td>
                  <td className="px-4 py-2.5">{STATUS_LABEL[r.status]}</td>
                  <td className="px-4 py-2.5 text-[color:var(--color-ink-500)]">
                    {new Date(r.vestsAt).toLocaleDateString('fr-FR')}
                  </td>
                  <td className="px-4 py-2.5">
                    {r.status === 'vested' ? (
                      <button
                        type="button"
                        onClick={() => markPaid(r)}
                        disabled={pending}
                        className="rounded-md border border-[color:var(--color-border)] px-2 py-1 text-xs font-medium transition-colors hover:bg-[color:var(--color-surface)] disabled:opacity-50"
                      >
                        Marquer versé
                      </button>
                    ) : (
                      <span className="text-[color:var(--color-ink-500)]">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {referrals.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-8 text-center text-sm text-[color:var(--color-ink-500)]"
                  >
                    Aucune attribution pour l&apos;instant.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/**
 * État du compte offert d'un partenaire, dans une seule cellule.
 *
 * Le jeton n'est rendu par le serveur que tant que le lien sert : un lien
 * consommé ou révoqué n'a plus de raison de circuler, donc il n'y a rien à
 * copier — seulement un état à lire. « Nouveau lien » reste proposé dans tous
 * les cas : regénérer un lien perdu doit rester trivial (et révoque
 * automatiquement le précédent côté serveur).
 */
function PartnerInviteCell({
  invite,
  pending,
  onCreate,
  onRevoke,
  onSend,
  fallbackEmail,
  buildUrl,
}: {
  invite: PartnerInvite | null;
  pending: boolean;
  onCreate: () => void;
  onRevoke: (inviteId: string) => void;
  onSend: (inviteId: string) => void;
  /** E-mail de l'affilié, si l'invitation n'en porte pas elle-même. */
  fallbackEmail: string | null;
  buildUrl: (token: string) => string;
}) {
  const [copied, setCopied] = useState(false);
  // Le serveur résout le destinataire ; on reproduit la même chaîne ici pour
  // savoir s'il y a une adresse à servir, et laquelle annoncer au survol.
  const recipient = invite?.inviteeEmail ?? fallbackEmail;

  if (!invite) {
    return (
      <button
        type="button"
        onClick={onCreate}
        disabled={pending}
        className="rounded-md border border-[color:var(--color-border)] px-2.5 py-1 text-xs disabled:opacity-50"
      >
        Créer le lien
      </button>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <span className="text-xs text-[color:var(--color-ink-500)]">
        {INVITE_STATE_LABEL[invite.state]} · {invite.grantMonths} mois {invite.grantTier}
      </span>
      {invite.lastSentAt ? (
        <span className="text-[11px] text-[color:var(--color-ink-500)]">
          Envoyé {invite.sendCount > 1 ? `${invite.sendCount}× ` : ''}à {invite.lastSentTo} le{' '}
          {new Date(invite.lastSentAt).toLocaleDateString('fr-FR')}
        </span>
      ) : null}
      {invite.state === 'usable' && invite.token ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => onSend(invite.id)}
            disabled={pending || !recipient}
            title={
              recipient
                ? `Envoyer le lien à ${recipient}`
                : "Aucune adresse connue : renseignez l'e-mail de l'affilié pour pouvoir envoyer."
            }
            className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] px-2.5 py-1 text-[11px] font-medium disabled:opacity-50"
          >
            {invite.lastSentAt ? 'Renvoyer' : 'Envoyer par e-mail'}
          </button>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(buildUrl(invite.token!));
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2000);
            }}
            className="rounded-md border border-[color:var(--color-border)] px-2.5 py-1 font-mono text-[11px]"
          >
            {copied ? 'Copié' : 'Copier le lien'}
          </button>
          <button
            type="button"
            onClick={() => onRevoke(invite.id)}
            disabled={pending}
            className="rounded-md px-1.5 py-1 text-[11px] text-[color:var(--color-ink-500)] underline underline-offset-2 disabled:opacity-50"
          >
            Annuler
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onCreate}
          disabled={pending}
          className="rounded-md border border-[color:var(--color-border)] px-2.5 py-1 text-xs disabled:opacity-50"
        >
          Nouveau lien
        </button>
      )}
    </div>
  );
}
