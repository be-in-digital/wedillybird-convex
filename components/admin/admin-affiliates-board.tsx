'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  CheckCircle2,
  Handshake,
  Ban,
  Link2,
  Loader2,
  Mail,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  Users,
  Wallet,
} from 'lucide-react';
import { useConfirm } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  adminCreateAffiliateAction,
  adminCreatePartnerInviteAction,
  adminDeleteAffiliateAction,
  adminEnsureAffiliateCouponAction,
  adminMarkReferralPaidAction,
  adminRevokePartnerInviteAction,
  adminSendPartnerInviteAction,
  adminSetAffiliateContactAction,
  adminSetAffiliateStatusAction,
} from '@/app/[locale]/(app)/admin/actions';
import { formatDate, formatMoneyMinor } from '@/lib/admin/format';
import { cn } from '@/lib/cn';
import { AdminDataTable, type AdminColumn } from './ui/data-table';
import { AdminSection } from './ui/section';
import { AdminStat, AdminStatGrid } from './ui/stat-card';
import { StatusPill, type StatusTone } from './ui/status-pill';

/**
 * Champ de formulaire du back-office : libellé au-dessus, aide en dessous.
 *
 * Le formulaire de création alignait sept `<input>` bruts sur une grille de six
 * colonnes, sans un mot d'explication : on y lisait « Remise filleul % » sans
 * savoir ce que ça coûte ni où est la limite. Chaque champ porte désormais son
 * aide, et la limite se voit avant d'être franchie (cf. `CapMeter`).
 */
type LedgerTotal = { currency: string; status: Referral['status']; minor: number };

/**
 * Somme d'un statut du ledger, toutes devises confondues.
 *
 * Les commissions ne vivent pas toutes en euros : additionner les montants
 * mineurs de devises différentes donnerait un nombre qui ne veut rien dire. On
 * rend donc une chaîne par devise, séparées par une puce.
 */
function sumLabel(totals: readonly LedgerTotal[], status: Referral['status']): string {
  const rows = totals.filter((t) => t.status === status);
  if (rows.length === 0) return '—';
  return rows.map((t) => fmtMinor(t.minor, t.currency)).join(' · ');
}

function hasAmount(totals: readonly LedgerTotal[], status: Referral['status']): boolean {
  return totals.some((t) => t.status === status && t.minor > 0);
}

/** Message de retour d'action — un `<span>` nu ne se voyait pas. */
function Banner({ tone, children }: { tone: 'danger' | 'success'; children: React.ReactNode }) {
  const Icon = tone === 'danger' ? AlertTriangle : CheckCircle2;
  return (
    <p
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2 rounded-lg px-3 py-2 text-sm',
        tone === 'danger'
          ? 'bg-[color:var(--color-danger-soft)] text-[color:color-mix(in_oklab,var(--color-danger),var(--color-foreground)_40%)]'
          : 'bg-[color:var(--color-success-soft)] text-[color:color-mix(in_oklab,var(--color-success),var(--color-foreground)_42%)]',
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

function Field({
  label,
  hint,
  htmlFor,
  className,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <label
        htmlFor={htmlFor}
        className="text-[0.6875rem] font-semibold tracking-[0.08em] text-[color:var(--color-muted-foreground)] uppercase"
      >
        {label}
      </label>
      {children}
      {hint ? (
        <p className="text-xs leading-snug text-[color:var(--color-muted-foreground)]">{hint}</p>
      ) : null}
    </div>
  );
}

/** Intertitre d'un groupe de champs — sépare identité, économie et contact. */
function FieldGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3 border-t border-[color:var(--color-border)] pt-5 first:border-0 first:pt-0">
      <legend className="sr-only">{title}</legend>
      <p className="text-sm font-semibold text-[color:var(--color-foreground)]">{title}</p>
      {children}
    </fieldset>
  );
}

/**
 * Charge combinée commission + remise, rapportée au plafond de marge.
 *
 * Le plafond n'existait qu'en message d'erreur, après coup. Le voir monter,
 * c'est pouvoir s'arrêter avant — et comprendre pourquoi la limite est là.
 */
function CapMeter({ combinedBps }: { combinedBps: number }) {
  const pct = combinedBps / 100;
  const capPct = MAX_COMBINED_BPS / 100;
  const over = combinedBps > MAX_COMBINED_BPS;
  const width = Math.min((combinedBps / MAX_COMBINED_BPS) * 100, 100);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="text-[color:var(--color-muted-foreground)]">Charge combinée</span>
        <span className="font-mono tabular-nums">
          <span className={over ? 'text-[color:var(--color-danger)]' : undefined}>{pct} %</span>
          <span className="text-[color:var(--color-muted-foreground)]"> / {capPct} % max</span>
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[color:var(--color-surface-elevated)]">
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-300 ease-[var(--ease-out-quint)]',
            over ? 'bg-[color:var(--color-danger)]' : 'bg-[color:var(--color-primary)]',
          )}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

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
  /** Forfait offert quand le lien est de type `couple`. */
  grantEventTier: 'essential' | 'premium';
  grantMonths: number;
  expiresAt: number;
  consumedAt: number | null;
  createdAt: number;
  /** Type de compte ouvert par le lien : agence ou compte personnel. */
  kind: 'pro' | 'couple';
  /** Dernier envoi réussi — dit à l'admin s'il doit envoyer ou relancer. */
  lastSentAt: number | null;
  lastSentTo: string | null;
  sendCount: number;
}

/**
 * Ce qu'un lien offre, choisi à sa création.
 *
 * Les valeurs vivent côté serveur (`DEFAULT_PARTNER_COMP_TIER`,
 * `DEFAULT_PARTNER_COMP_MONTHS`, `DEFAULT_COMPED_EVENT_PLAN`) ; celles d'ici ne
 * font que **pré-remplir les menus**. Un champ laissé au défaut n'est pas
 * transmis, pour qu'il n'existe jamais deux sources de vérité qui dérivent.
 */
export interface InviteGrantOptions {
  grantTier?: 'starter' | 'business' | 'agency';
  grantMonths?: number;
  grantEventTier?: 'essential' | 'premium';
}

const TIER_OPTIONS: ReadonlyArray<{ value: 'starter' | 'business' | 'agency'; label: string }> = [
  { value: 'agency', label: 'Agency' },
  { value: 'business', label: 'Business' },
  { value: 'starter', label: 'Starter' },
];

/** Durées proposées, en mois. Le serveur accepte 1 à 24. */
const MONTHS_OPTIONS: ReadonlyArray<number> = [3, 6, 12, 18, 24];

const EVENT_TIER_OPTIONS: ReadonlyArray<{ value: 'essential' | 'premium'; label: string }> = [
  { value: 'premium', label: 'Premium' },
  { value: 'essential', label: 'Essentiel' },
];

/**
 * Pré-sélection des menus. Doit rester alignée sur les défauts serveur — un
 * test croise les deux pour que l'écran n'annonce jamais autre chose que ce
 * que le lien offrira réellement.
 */
const DEFAULT_TIER = 'agency' as const;
const DEFAULT_MONTHS = 12;
const DEFAULT_EVENT_TIER = 'premium' as const;

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

/** Tons du ledger : « acquis » attend une action, « reversé » est une annulation. */
const LEDGER_STATUS_TONE: Record<Referral['status'], StatusTone> = {
  pending: 'progress',
  vested: 'warning',
  paid: 'success',
  credited: 'success',
  reversed: 'danger',
};

const STATUS_LABEL: Record<Referral['status'], string> = {
  pending: 'En attente',
  vested: 'Acquis',
  paid: 'Payé',
  credited: 'Crédité',
  reversed: 'Annulé',
};

/**
 * Montant d'une commission.
 *
 * La récompense est une proportion du `netMinor` du paiement : elle porte donc
 * la convention de sa devise. Cette fonction divisait toujours par 100, ce qui
 * affichait une commission en XOF (zéro-décimale) cent fois trop petite, et une
 * commission en TND (millimes) dix fois trop grande — sur un écran de payout.
 * Le formateur partagé porte la seule table de décimales du projet.
 */
function fmtMinor(minor: number, currency: string): string {
  return formatMoneyMinor(minor, currency);
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
  const { confirm, confirmDialog } = useConfirm();
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
    // La récompense DÉCOULE de la nature : parrainage = crédit (100 % auto),
    // partenaire = cash. Le serveur refuse tout autre couple
    // (`REWARD_TYPE_MISMATCH`) ; le champ est donc affiché mais non modifiable,
    // plutôt que de laisser composer un affilié que la création rejettera.
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
   * Efface un affilié — le seul moyen de rendre son `code`, qui est unique.
   * Convex refuse dès qu'une commission existe : le message le dit, plutôt
   * que d'échouer en silence sur un tableau qui ne bouge pas.
   */
  function remove(a: Affiliate) {
    setError(null);
    void (async () => {
      const ok = await confirm({
        title: `Supprimer l'affilié ${a.code} ?`,
        description:
          "Le code redevient libre, son lien d'invitation est coupé et sa remise Stripe désactivée. Irréversible. Un affilié qui a déjà généré une commission ne peut pas être supprimé — désactivez-le.",
        confirmLabel: 'Supprimer',
        destructive: true,
      });
      if (!ok) return;
      startTransition(async () => {
        const res = await adminDeleteAffiliateAction(a.id);
        if (!res.ok) {
          setError(
            res.error === 'AFFILIATE_HAS_REFERRALS'
              ? `${a.code} a déjà des commissions au ledger : il se désactive, il ne se supprime pas.`
              : res.error,
          );
          return;
        }
        // Supprimé côté Convex mais coupon Stripe encore debout : le code
        // resterait saisissable au checkout alors que plus rien ne l'attribue.
        if (res.stripeError) {
          setError(
            `Affilié supprimé, mais code promo Stripe NON désactivé (${res.stripeError}). Coupez-le depuis Stripe.`,
          );
        }
        router.refresh();
      });
    })();
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

  function setContact(
    a: Affiliate,
    next: { ownerEmail: string | null; displayName: string | null },
  ) {
    setError(null);
    startTransition(async () => {
      const res = await adminSetAffiliateContactAction(a.id, next);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  function createInvite(a: Affiliate, kind: 'pro' | 'couple', grant: InviteGrantOptions) {
    setError(null);
    startTransition(async () => {
      const res = await adminCreatePartnerInviteAction(a.id, {
        ...(a.ownerEmail ? { inviteeEmail: a.ownerEmail } : {}),
        ...(a.displayName ? { inviteeName: a.displayName } : {}),
        kind,
        ...grant,
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

  const affiliateColumns: AdminColumn<Affiliate>[] = [
    {
      // Code et nom dans la même colonne : ils désignent la même personne, et
      // les séparer forçait à balayer la ligne pour savoir qui est « NORAH10 ».
      id: 'affiliate',
      header: 'Affilié',
      card: 'title',
      sortValue: (a) => a.code,
      cell: (a) => (
        <div className="min-w-0">
          <p className="font-mono font-medium tracking-wide">{a.code}</p>
          <p className="truncate text-xs text-[color:var(--color-muted-foreground)]">
            {a.displayName ?? 'Sans nom affiché'}
          </p>
          <p className="mt-1">
            {a.shareCode ? (
              <span
                className="inline-flex items-center gap-1 rounded bg-[color:var(--color-surface-elevated)] px-1.5 py-0.5 font-mono text-[0.6875rem]"
                title="Code saisissable au checkout"
              >
                <Link2 className="h-3 w-3 shrink-0" strokeWidth={2} aria-hidden />
                {a.shareCode}
              </span>
            ) : a.buyerDiscountBps > 0 ? (
              <button
                type="button"
                onClick={() => ensureCoupon(a)}
                disabled={pending}
                className="focus-ring inline-flex h-6 items-center rounded border border-[color:var(--color-border)] px-1.5 text-[0.6875rem] font-medium transition-colors hover:bg-[color:var(--color-surface-elevated)] disabled:opacity-50"
              >
                Créer le code
              </button>
            ) : (
              <span
                className="text-[0.6875rem] text-[color:var(--color-muted-foreground)]"
                title="Sans remise filleul, il n'y a rien à faire taper au checkout — seul le lien attribue."
              >
                lien seul
              </span>
            )}
          </p>
        </div>
      ),
    },
    {
      id: 'program',
      header: 'Programme',
      sortValue: (a) => a.kind,
      cell: (a) => (
        <div className="min-w-0 whitespace-nowrap">
          <p className="text-sm">
            {a.kind === 'referral' ? 'Parrainage' : 'Partenaire'}
            <span className="text-[color:var(--color-muted-foreground)]">
              {' · '}
              {a.rewardType === 'credit' ? 'crédit' : 'cash'}
            </span>
          </p>
          <p
            className="font-mono text-xs text-[color:var(--color-muted-foreground)] tabular-nums"
            title="Commission versée à l'affilié / remise accordée au filleul"
          >
            {a.rateBps / 100} % / {a.buyerDiscountBps / 100} %
          </p>
        </div>
      ),
    },
    {
      id: 'contact',
      header: 'Contact',
      sortValue: (a) => a.ownerEmail ?? '',
      cell: (a) => (
        <ContactCell affiliate={a} pending={pending} onSave={(next) => setContact(a, next)} />
      ),
      hideBelow: 'lg',
    },
    {
      /* Le lien d'invitation n'a de sens que pour un partenaire : le parrainage
         particulier n'ouvre pas de compte agence. */
      id: 'invite',
      header: 'Compte offert',
      cell: (a) =>
        a.kind !== 'partner' ? (
          <span className="text-xs text-[color:var(--color-muted-foreground)]">—</span>
        ) : (
          <PartnerInviteCell
            invite={latestInvite.get(a.id) ?? null}
            pending={pending}
            onCreate={(kind, grant) => createInvite(a, kind, grant)}
            onRevoke={revokeInvite}
            onSend={sendInvite}
            fallbackEmail={a.ownerEmail ?? null}
            buildUrl={inviteUrl}
          />
        ),
      hideBelow: 'lg',
    },
    {
      id: 'status',
      header: 'Statut',
      card: 'badge',
      sortValue: (a) => a.status,
      cell: (a) => (
        <StatusPill tone={a.status === 'active' ? 'success' : 'neutral'}>
          {a.status === 'active' ? 'Actif' : 'Désactivé'}
        </StatusPill>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      card: 'actions',
      align: 'right',
      width: 'w-16',
      cell: (a) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={pending}
              aria-label={`Actions sur ${a.code}`}
              className="focus-ring inline-flex h-8 w-8 items-center justify-center rounded-md text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-surface-elevated)] hover:text-[color:var(--color-foreground)] disabled:opacity-50"
            >
              <MoreHorizontal className="h-4 w-4" strokeWidth={2} aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onSelect={() => toggle(a)}>
              {a.status === 'active' ? (
                <Ban strokeWidth={1.75} aria-hidden />
              ) : (
                <CheckCircle2 strokeWidth={1.75} aria-hidden />
              )}
              {a.status === 'active' ? 'Désactiver' : 'Réactiver'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              data-testid="admin-delete-affiliate"
              onSelect={() => remove(a)}
            >
              <Trash2 strokeWidth={1.75} aria-hidden />
              Supprimer
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const ledgerColumns: AdminColumn<Referral>[] = [
    {
      id: 'code',
      header: 'Code',
      card: 'title',
      sortValue: (r) => r.code,
      cell: (r) => <span className="font-mono">{r.code}</span>,
    },
    {
      id: 'net',
      header: 'Vente (net)',
      align: 'right',
      sortValue: (r) => r.netMinor,
      cell: (r) => (
        <span className="font-mono whitespace-nowrap tabular-nums">
          {fmtMinor(r.netMinor, r.currency)}
        </span>
      ),
    },
    {
      /* Ce sur quoi la commission a réellement été calculée : c'est ici qu'on
         tranche un litige sur un montant. */
      id: 'base',
      header: 'Assiette HT',
      align: 'right',
      sortValue: (r) => r.commissionBaseMinor,
      cell: (r) => (
        <span className="font-mono whitespace-nowrap text-[color:var(--color-muted-foreground)] tabular-nums">
          {r.commissionBaseMinor === null ? '—' : fmtMinor(r.commissionBaseMinor, r.currency)}
        </span>
      ),
      hideBelow: 'xl',
    },
    {
      id: 'reward',
      header: 'Récompense',
      align: 'right',
      sortValue: (r) => r.rewardMinor,
      cell: (r) => (
        <span className="font-mono whitespace-nowrap tabular-nums">
          {fmtMinor(r.rewardMinor, r.currency)}
          <span className="ml-1 text-[color:var(--color-muted-foreground)]">
            ({r.rewardType === 'credit' ? 'crédit' : 'cash'})
          </span>
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Statut',
      card: 'badge',
      sortValue: (r) => r.status,
      cell: (r) => (
        <StatusPill tone={LEDGER_STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</StatusPill>
      ),
    },
    {
      id: 'vestsAt',
      header: 'Acquis le',
      sortValue: (r) => r.vestsAt,
      cell: (r) => (
        <span className="whitespace-nowrap text-[color:var(--color-muted-foreground)]">
          {formatDate(r.vestsAt)}
        </span>
      ),
      hideBelow: 'lg',
    },
    {
      id: 'payout',
      header: 'Versement',
      card: 'actions',
      align: 'right',
      width: 'w-36',
      cell: (r) =>
        // Seules les commissions CASH se versent. Un crédit se dépense à un
        // achat ; le « verser » le retirerait du solde du parrain sans
        // contrepartie.
        r.status === 'vested' && r.rewardType === 'cash' ? (
          <button
            type="button"
            onClick={() => markPaid(r)}
            disabled={pending}
            className="focus-ring rounded-md border border-[color:var(--color-border)] px-2 py-1 text-xs font-medium transition-colors hover:bg-[color:var(--color-surface-elevated)] disabled:opacity-50"
          >
            Marquer versé
          </button>
        ) : (
          <span className="text-[color:var(--color-muted-foreground)]">—</span>
        ),
    },
  ];

  // Ce que coûte réellement le couple commission/remise, sur une base neutre :
  // 100 € HT encaissés. Dire « 20 % » ne se traduit pas tout seul en euros.
  const commissionOn100 = (ratePct * 100) / 100;

  const activeCount = affiliates.filter((a) => a.status === 'active').length;
  const partnerCount = affiliates.filter((a) => a.kind === 'partner').length;

  return (
    <div className="flex flex-col gap-8">
      {/* Ce que le programme doit et ce qu'il pèse — avant le détail ligne à ligne. */}
      <AdminStatGrid cols={4}>
        <AdminStat
          icon={Users}
          label="Affiliés actifs"
          value={String(activeCount)}
          hint={`${affiliates.length} au total · ${partnerCount} partenaire${partnerCount > 1 ? 's' : ''}`}
        />
        <AdminStat
          icon={Wallet}
          label="À verser"
          value={sumLabel(totals, 'vested')}
          hint="Commissions acquises, virement manuel"
          tone={hasAmount(totals, 'vested') ? 'critical' : 'default'}
        />
        <AdminStat
          icon={Handshake}
          label="En attente"
          value={sumLabel(totals, 'pending')}
          hint="Acquises à la date de l'event"
        />
        <AdminStat
          icon={Link2}
          label="Attributions"
          value={String(referrals.length)}
          hint="Ventes rattachées à un code"
        />
      </AdminStatGrid>

      {/* Création — volontairement en place et non derrière une modale : ouvrir
          un partenariat est le geste principal de cet écran. */}
      <AdminSection
        title="Nouvel affilié"
        description="Programme sur invitation. Le type décide de la récompense : partenaire = cash versé à la main, parrainage = crédit appliqué automatiquement au prochain achat du parrain."
        contentClassName="p-5"
      >
        <div className="flex flex-col gap-5">
          <FieldGroup title="Identité">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field
                label="Code"
                htmlFor="affiliate-code"
                hint="3 à 24 caractères, lettres et chiffres. C'est lui qui attribue la vente."
              >
                <Input
                  id="affiliate-code"
                  className="h-10 font-mono tracking-wide"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="NORAH10"
                  aria-invalid={code.length > 0 && !codeValid}
                  data-testid="affiliate-code"
                />
              </Field>
              <Field
                label="Type"
                hint={
                  kind === 'partner'
                    ? 'Récompense : cash. Le partenaire peut recevoir un compte agence offert.'
                    : 'Récompense : crédit, appliqué au prochain achat du parrain.'
                }
              >
                <Select
                  value={kind}
                  onValueChange={(v) => onKindChange(v as 'referral' | 'partner')}
                >
                  <SelectTrigger className="h-10" aria-label="Type d'affilié">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="partner">Partenaire</SelectItem>
                    <SelectItem value="referral">Parrainage</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </FieldGroup>

          <FieldGroup title="Économie">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field
                label="Commission"
                htmlFor="affiliate-rate"
                hint={`${commissionOn100.toLocaleString('fr-FR')} € pour 100 € HT encaissés.`}
              >
                <div className="relative">
                  <Input
                    id="affiliate-rate"
                    type="number"
                    min={0}
                    max={25}
                    className="h-10 pr-8 font-mono tabular-nums"
                    value={ratePct}
                    onChange={(e) => setRatePct(Number(e.target.value))}
                    data-testid="affiliate-rate"
                  />
                  <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-[color:var(--color-muted-foreground)]">
                    %
                  </span>
                </div>
              </Field>
              <Field
                label="Remise filleul"
                htmlFor="affiliate-discount"
                hint={
                  discountPct > 0
                    ? 'Un code promo Stripe est créé : le filleul peut le taper au checkout.'
                    : 'À 0, aucun code saisissable — seul le lien attribue la vente.'
                }
              >
                <div className="relative">
                  <Input
                    id="affiliate-discount"
                    type="number"
                    min={0}
                    max={25}
                    className="h-10 pr-8 font-mono tabular-nums"
                    value={discountPct}
                    onChange={(e) => setDiscountPct(Number(e.target.value))}
                    data-testid="affiliate-discount"
                  />
                  <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-[color:var(--color-muted-foreground)]">
                    %
                  </span>
                </div>
              </Field>
              <div className="flex flex-col justify-center gap-2 sm:col-span-2 lg:col-span-1">
                <CapMeter combinedBps={combinedBps} />
                {overCap ? (
                  <p className="flex items-start gap-1.5 text-xs text-[color:var(--color-danger)]">
                    <AlertTriangle
                      className="mt-0.5 h-3.5 w-3.5 shrink-0"
                      strokeWidth={2}
                      aria-hidden
                    />
                    Au-delà de 25 %, la marge de l&apos;Essentiel ne tient plus.
                  </p>
                ) : null}
              </div>
            </div>
          </FieldGroup>

          <FieldGroup title="Contact">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field
                label="Nom affiché"
                htmlFor="affiliate-display-name"
                hint="Tel qu'il apparaît dans le back-office et sur l'invitation."
              >
                <Input
                  id="affiliate-display-name"
                  className="h-10"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Norah — @norah"
                  data-testid="affiliate-display-name"
                />
              </Field>
              <Field
                label="E-mail (payout)"
                htmlFor="affiliate-owner-email"
                hint="Sans adresse, le lien d'invitation ne pourra être que copié, pas envoyé."
                className="sm:col-span-2 lg:col-span-2"
              >
                <Input
                  id="affiliate-owner-email"
                  type="email"
                  className="h-10"
                  value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                  placeholder="norah@exemple.com"
                  data-testid="affiliate-owner-email"
                />
              </Field>
            </div>
          </FieldGroup>

          <div className="flex flex-col gap-3 border-t border-[color:var(--color-border)] pt-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 space-y-1.5">
              {error ? <Banner tone="danger">{error}</Banner> : null}
              {sent ? <Banner tone="success">Invitation envoyée à {sent}.</Banner> : null}
            </div>
            <button
              type="button"
              onClick={create}
              data-testid="affiliate-create"
              disabled={pending || !codeValid || overCap}
              className="focus-ring inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-[color:var(--color-primary)] px-4 text-sm font-medium text-[color:var(--color-primary-foreground)] transition-colors hover:bg-[color:var(--color-primary-hover)] disabled:pointer-events-none disabled:opacity-50"
            >
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden />
              ) : (
                <Plus className="h-4 w-4" strokeWidth={2} aria-hidden />
              )}
              Créer l&apos;affilié
            </button>
          </div>
        </div>
      </AdminSection>

      <AdminSection
        title="Affiliés"
        description="Un code par affilié. Le lien attribue la vente ; le code partageable, lui, se tape au checkout."
        bare
      >
        <AdminDataTable
          rows={affiliates}
          columns={affiliateColumns}
          getRowId={(a) => a.id}
          searchable={(a) =>
            `${a.code} ${a.shareCode ?? ''} ${a.displayName ?? ''} ${a.ownerEmail ?? ''}`
          }
          emptyTitle="Aucun affilié"
          emptyDescription="Créez-en un ci-dessus (invitation-only)."
          emptyIcon={Handshake}
        />
      </AdminSection>

      <AdminSection
        title="Commissions"
        description="Chaque vente rattachée à un code. Le versement cash est manuel : « Marquer versé » l’acte au ledger."
        bare
      >
        <AdminDataTable
          rows={referrals}
          columns={ledgerColumns}
          getRowId={(r) => r.id}
          searchable={(r) => `${r.code} ${r.status} ${r.rewardType}`}
          initialSort={{ id: 'vestsAt', dir: 'desc' }}
          emptyTitle="Aucune attribution"
          emptyDescription="Les ventes attribuées à un code affilié apparaîtront ici."
          emptyIcon={Handshake}
        />
      </AdminSection>
      {confirmDialog}
    </div>
  );
}

/**
 * Contact d'un affilié : nom affiché et adresse d'envoi, lisibles et corrigibles.
 *
 * La cellule ne montrait que `displayName ?? ownerEmail`. Un affilié nommé mais
 * sans adresse paraissait donc complet, pendant que « Envoyer par e-mail »
 * restait grisé — le tableau disait le contraire du bouton. Elle montre
 * maintenant les deux, et nomme l'absence : c'est ce manque précis qui bloque
 * l'envoi.
 */
function ContactCell({
  affiliate,
  pending,
  onSave,
}: {
  affiliate: Affiliate;
  pending: boolean;
  onSave: (next: { ownerEmail: string | null; displayName: string | null }) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState(affiliate.ownerEmail ?? '');
  const [name, setName] = useState(affiliate.displayName ?? '');

  if (editing) {
    return (
      <div className="flex w-56 flex-col gap-2">
        <Input
          aria-label="Nom affiché du partenaire"
          className="h-8 text-xs"
          value={name}
          disabled={pending}
          placeholder="Nom affiché"
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          aria-label="Adresse e-mail du partenaire"
          className="h-8 text-xs"
          type="email"
          value={email}
          disabled={pending}
          placeholder="sarah@exemple.com"
          onChange={(e) => setEmail(e.target.value)}
        />
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              onSave({ ownerEmail: email.trim() || null, displayName: name.trim() || null });
              setEditing(false);
            }}
            className="focus-ring inline-flex h-7 items-center rounded-md bg-[color:var(--color-primary)] px-2.5 text-xs font-medium text-[color:var(--color-primary-foreground)] disabled:opacity-50"
          >
            Enregistrer
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setEmail(affiliate.ownerEmail ?? '');
              setName(affiliate.displayName ?? '');
              setEditing(false);
            }}
            className="focus-ring inline-flex h-7 items-center rounded-md px-2 text-xs text-[color:var(--color-muted-foreground)] transition-colors hover:text-[color:var(--color-foreground)] disabled:opacity-50"
          >
            Annuler
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group/contact flex min-w-0 items-start gap-1.5">
      <div className="min-w-0">
        {affiliate.ownerEmail ? (
          <p className="truncate text-sm">{affiliate.ownerEmail}</p>
        ) : (
          <p
            className="inline-flex items-center gap-1 text-xs text-[color:var(--color-warning)]"
            title="Sans adresse, le lien d'invitation ne peut pas être envoyé — seulement copié."
          >
            <Mail className="h-3 w-3 shrink-0" strokeWidth={2} aria-hidden />
            Aucune adresse
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => setEditing(true)}
        disabled={pending}
        aria-label={`Modifier le contact de ${affiliate.code}`}
        className="focus-ring inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-[color:var(--color-muted-foreground)] opacity-0 transition-opacity group-hover/contact:opacity-100 hover:text-[color:var(--color-foreground)] focus-visible:opacity-100 disabled:opacity-50"
      >
        <Pencil className="h-3 w-3" strokeWidth={2} aria-hidden />
      </button>
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
  onCreate: (kind: 'pro' | 'couple', grant: InviteGrantOptions) => void;
  onRevoke: (inviteId: string) => void;
  onSend: (inviteId: string) => void;
  /** E-mail de l'affilié, si l'invitation n'en porte pas elle-même. */
  fallbackEmail: string | null;
  buildUrl: (token: string) => string;
}) {
  const [copied, setCopied] = useState(false);
  // Ce que le prochain lien offrira. Volontairement pré-rempli sur les défauts
  // et NON sur l'invitation existante : « Nouveau lien » sert le plus souvent à
  // remettre un partenaire aux conditions courantes, pas à reconduire des
  // conditions périmées. Les menus restent visibles avant le clic, donc rien
  // ne change en silence.
  const [tier, setTier] = useState<'starter' | 'business' | 'agency'>(DEFAULT_TIER);
  const [months, setMonths] = useState<number>(DEFAULT_MONTHS);
  const [eventTier, setEventTier] = useState<'essential' | 'premium'>(DEFAULT_EVENT_TIER);
  // Le serveur résout le destinataire ; on reproduit la même chaîne ici pour
  // savoir s'il y a une adresse à servir, et laquelle annoncer au survol.
  const recipient = invite?.inviteeEmail ?? fallbackEmail;

  const selectCls = 'h-8 w-auto min-w-0 gap-1.5 px-2 text-xs';
  const createBtnCls =
    'focus-ring inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[color:var(--color-border)] px-2.5 text-xs font-medium whitespace-nowrap transition-colors hover:bg-[color:var(--color-surface-elevated)] disabled:opacity-50';

  /**
   * Les deux offres, chacune avec ses propres réglages.
   *
   * Deux lignes plutôt qu'un choix caché : le type de lien décide de ce qu'on
   * donne — un abonnement agence qui court dans le temps, ou un forfait de
   * mariage acheté une fois — et ne se corrige pas après coup, le lien consommé
   * ayant déjà créé le compte. Les mois n'apparaissent que côté agence : un
   * forfait particulier n'a pas de durée, il a une rétention de galerie liée à
   * la date du mariage.
   */
  const creationControls = (
    <div className="flex min-w-[14rem] flex-col gap-2.5">
      <div className="flex flex-col gap-1">
        <span className="text-[0.625rem] font-semibold tracking-[0.08em] text-[color:var(--color-muted-foreground)] uppercase">
          Compte agence
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          <Select value={tier} disabled={pending} onValueChange={(v) => setTier(v as typeof tier)}>
            <SelectTrigger className={selectCls} aria-label="Palier offert à l'agence">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIER_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={String(months)}
            disabled={pending}
            onValueChange={(v) => setMonths(Number(v))}
          >
            <SelectTrigger className={selectCls} aria-label="Durée du compte offert, en mois">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTHS_OPTIONS.map((m) => (
                <SelectItem key={m} value={String(m)}>
                  {m} mois
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            type="button"
            onClick={() => onCreate('pro', { grantTier: tier, grantMonths: months })}
            disabled={pending}
            className={createBtnCls}
          >
            <Link2 className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            Lien agence
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[0.625rem] font-semibold tracking-[0.08em] text-[color:var(--color-muted-foreground)] uppercase">
          Compte personnel
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          <Select
            value={eventTier}
            disabled={pending}
            onValueChange={(v) => setEventTier(v as typeof eventTier)}
          >
            <SelectTrigger className={selectCls} aria-label="Forfait offert au particulier">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EVENT_TIER_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            type="button"
            onClick={() => onCreate('couple', { grantEventTier: eventTier })}
            disabled={pending}
            className={createBtnCls}
          >
            <Link2 className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            Lien personnel
          </button>
        </div>
      </div>
    </div>
  );

  if (!invite) {
    return creationControls;
  }

  const stateTone: StatusTone =
    invite.state === 'usable' ? 'success' : invite.state === 'consumed' ? 'info' : 'neutral';

  return (
    <div className="flex min-w-[14rem] flex-col items-start gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusPill tone={stateTone}>{INVITE_STATE_LABEL[invite.state]}</StatusPill>
        <span className="text-xs text-[color:var(--color-muted-foreground)]">
          {invite.kind === 'couple'
            ? `mariage ${invite.grantEventTier === 'premium' ? 'Premium' : 'Essentiel'} offert`
            : `${invite.grantMonths} mois ${invite.grantTier}`}
        </span>
      </div>

      {invite.lastSentAt ? (
        <p className="text-xs text-[color:var(--color-muted-foreground)]">
          Envoyé {invite.sendCount > 1 ? `${invite.sendCount}× ` : ''}à {invite.lastSentTo} le{' '}
          {formatDate(invite.lastSentAt)}
        </p>
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
            className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md bg-[color:var(--color-primary)] px-2.5 text-xs font-medium text-[color:var(--color-primary-foreground)] transition-colors hover:bg-[color:var(--color-primary-hover)] disabled:opacity-50"
          >
            <Mail className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            {invite.lastSentAt ? 'Renvoyer' : 'Envoyer'}
          </button>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(buildUrl(invite.token!));
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2000);
            }}
            className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md border border-[color:var(--color-border)] px-2.5 text-xs font-medium transition-colors hover:bg-[color:var(--color-surface-elevated)]"
          >
            {copied ? (
              <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            ) : (
              <Link2 className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            )}
            {copied ? 'Copié' : 'Copier le lien'}
          </button>
          <button
            type="button"
            onClick={() => onRevoke(invite.id)}
            disabled={pending}
            className="focus-ring inline-flex h-8 items-center rounded-md px-2 text-xs text-[color:var(--color-muted-foreground)] transition-colors hover:text-[color:var(--color-foreground)] disabled:opacity-50"
          >
            Annuler
          </button>
        </div>
      ) : (
        // Regénérer, c'est re-choisir : un lien mort se remplace le plus
        // souvent parce que les conditions ont changé.
        creationControls
      )}
    </div>
  );
}
