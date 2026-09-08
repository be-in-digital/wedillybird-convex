'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { Ticket } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  adminCreateCouponAction,
  adminDeleteCouponAction,
  adminSetPromotionCodeActiveAction,
  adminApplyDiscountToOrgAction,
  adminRemoveOrgDiscountAction,
  type CreateCouponInput,
} from '@/app/[locale]/(app)/admin/actions';
import { STRIPE_COUPON_NAME_MAX_LENGTH } from '@/lib/payments/coupon-name';
import { formatDate } from '@/lib/admin/format';
import { AdminDataTable, type AdminColumn } from './ui/data-table';
import { AdminSection } from './ui/section';
import { StatusPill } from './ui/status-pill';

type Coupon = {
  id: string;
  name: string | null;
  percentOff: number | null;
  amountOffMinor: number | null;
  currency: string | null;
  duration: 'once' | 'repeating' | 'forever';
  durationInMonths: number | null;
  maxRedemptions: number | null;
  timesRedeemed: number;
  redeemBy: number | null;
  valid: boolean;
  createdAt: number;
  appliesToProducts?: string[];
};

type PromoCode = {
  id: string;
  code: string;
  couponId: string;
  couponLabel: string;
  active: boolean;
  maxRedemptions: number | null;
  timesRedeemed: number;
  expiresAt: number | null;
  createdAt: number;
};

type SubscribedOrg = {
  _id: string;
  name: string;
  subscriptionTier?: string;
  subscriptionStatus?: string;
};

const DURATION_LABEL: Record<string, string> = {
  once: 'Une fois',
  repeating: 'Récurrent',
  forever: 'Permanent',
};

/** Un coupon 100 % récurrent sur N mois = « essai gratuit » (mois offerts). */
function isTrialCoupon(c: Coupon): boolean {
  return c.percentOff === 100 && c.duration === 'repeating' && (c.durationInMonths ?? 0) > 0;
}

function couponValue(c: Coupon): string {
  if (isTrialCoupon(c)) return `${c.durationInMonths} mois offerts`;
  if (c.percentOff != null) return `−${c.percentOff} %`;
  if (c.amountOffMinor != null)
    return `−${(c.amountOffMinor / 100).toFixed(0)} ${c.currency ?? 'EUR'}`;
  return '—';
}

export function AdminPromotionsBoard({
  coupons,
  promoCodes,
  subscribedOrgs = [],
}: {
  coupons: Coupon[];
  promoCodes: PromoCode[];
  subscribedOrgs?: SubscribedOrg[];
}) {
  const locale = useLocale();
  const router = useRouter();

  const couponColumns: AdminColumn<Coupon>[] = [
    {
      id: 'name',
      header: 'Nom',
      card: 'title',
      sortValue: (c) => c.name ?? c.id,
      cell: (c) => (
        <span className="flex flex-wrap items-center gap-2 font-medium">
          {c.name ?? c.id}
          {isTrialCoupon(c) ? <Badge variant="success">Essai</Badge> : null}
          {c.appliesToProducts && c.appliesToProducts.length > 0 ? (
            <Badge variant="neutral">Pros</Badge>
          ) : null}
        </span>
      ),
    },
    {
      id: 'value',
      header: 'Réduction',
      cell: (c) => <span className="font-mono whitespace-nowrap">{couponValue(c)}</span>,
    },
    {
      id: 'duration',
      header: 'Durée',
      sortValue: (c) => c.duration,
      cell: (c) => (
        <span className="text-[color:var(--color-muted-foreground)]">
          {DURATION_LABEL[c.duration]}
          {c.duration === 'repeating' && c.durationInMonths ? ` (${c.durationInMonths} mois)` : ''}
        </span>
      ),
      hideBelow: 'lg',
    },
    {
      id: 'redemptions',
      header: 'Utilisations',
      align: 'right',
      sortValue: (c) => c.timesRedeemed,
      cell: (c) => (
        <span className="font-mono tabular-nums">
          {c.timesRedeemed}
          {c.maxRedemptions != null ? ` / ${c.maxRedemptions}` : ''}
        </span>
      ),
    },
    {
      id: 'redeemBy',
      header: 'Expire',
      sortValue: (c) => c.redeemBy ?? null,
      cell: (c) => (
        <span className="whitespace-nowrap text-[color:var(--color-muted-foreground)]">
          {c.redeemBy ? formatDate(c.redeemBy, locale) : '—'}
        </span>
      ),
      hideBelow: 'lg',
    },
    {
      id: 'status',
      header: 'Statut',
      card: 'badge',
      sortValue: (c) => (c.valid ? 0 : 1),
      cell: (c) => (
        <StatusPill tone={c.valid ? 'success' : 'neutral'}>
          {c.valid ? 'Valide' : 'Expiré'}
        </StatusPill>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      card: 'actions',
      align: 'right',
      width: 'w-28',
      cell: (c) => <DeleteCouponButton couponId={c.id} onDone={() => router.refresh()} />,
    },
  ];

  const promoColumns: AdminColumn<PromoCode>[] = [
    {
      id: 'code',
      header: 'Code',
      card: 'title',
      sortValue: (p) => p.code,
      cell: (p) => <span className="font-mono font-medium">{p.code}</span>,
    },
    {
      id: 'coupon',
      header: 'Réduction',
      sortValue: (p) => p.couponLabel,
      cell: (p) => <span className="font-mono whitespace-nowrap">{p.couponLabel}</span>,
    },
    {
      id: 'redemptions',
      header: 'Utilisations',
      align: 'right',
      sortValue: (p) => p.timesRedeemed,
      cell: (p) => (
        <span className="font-mono tabular-nums">
          {p.timesRedeemed}
          {p.maxRedemptions != null ? ` / ${p.maxRedemptions}` : ''}
        </span>
      ),
    },
    {
      id: 'expiresAt',
      header: 'Expire',
      sortValue: (p) => p.expiresAt ?? null,
      cell: (p) => (
        <span className="whitespace-nowrap text-[color:var(--color-muted-foreground)]">
          {p.expiresAt ? formatDate(p.expiresAt, locale) : '—'}
        </span>
      ),
      hideBelow: 'lg',
    },
    {
      id: 'status',
      header: 'Statut',
      card: 'badge',
      sortValue: (p) => (p.active ? 0 : 1),
      cell: (p) => (
        <StatusPill tone={p.active ? 'success' : 'neutral'}>
          {p.active ? 'Actif' : 'Inactif'}
        </StatusPill>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      card: 'actions',
      align: 'right',
      width: 'w-28',
      cell: (p) => (
        <TogglePromoButton id={p.id} active={p.active} onDone={() => router.refresh()} />
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      {/* Remise directe sur un abonnement (geste commercial) */}
      <DiscountSection coupons={coupons} orgs={subscribedOrgs} onDone={() => router.refresh()} />

      <AdminSection
        title="Coupons"
        description="Réductions réutilisables (%, montant ou mois d'essai offerts), applicables aux forfaits couples et aux abonnements pros."
        actions={<CreateCouponDialog onDone={() => router.refresh()} />}
        bare
      >
        <AdminDataTable
          rows={coupons}
          columns={couponColumns}
          getRowId={(c) => c.id}
          searchable={(c) => `${c.name ?? ''} ${c.id} ${couponValue(c)}`}
          emptyTitle="Aucun coupon"
          emptyDescription="Créez-en un pour lancer une promo ou faire un geste commercial."
          emptyIcon={Ticket}
        />
      </AdminSection>

      <AdminSection
        title="Codes promo"
        description="Codes saisissables par les clients au paiement (couples et pros). Générés depuis un coupon."
        bare
      >
        <AdminDataTable
          rows={promoCodes}
          columns={promoColumns}
          getRowId={(p) => p.id}
          searchable={(p) => `${p.code} ${p.couponLabel}`}
          emptyTitle="Aucun code promo"
          emptyDescription="Générez un code depuis un coupon existant pour le communiquer aux clients."
          emptyIcon={Ticket}
        />
      </AdminSection>
    </div>
  );
}

function DiscountSection({
  coupons,
  orgs,
  onDone,
}: {
  coupons: Coupon[];
  orgs: SubscribedOrg[];
  onDone: () => void;
}) {
  const [orgId, setOrgId] = useState('');
  const [couponId, setCouponId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function apply() {
    setError(null);
    setOk(null);
    if (!orgId) return setError('Choisis une agence.');
    if (!couponId) return setError('Choisis un coupon.');
    startTransition(async () => {
      const res = await adminApplyDiscountToOrgAction(orgId, couponId);
      if (!res.ok) return setError(res.error);
      setOk('Remise appliquée à l’abonnement.');
      onDone();
    });
  }

  function remove() {
    setError(null);
    setOk(null);
    if (!orgId) return setError('Choisis une agence.');
    startTransition(async () => {
      const res = await adminRemoveOrgDiscountAction(orgId);
      if (!res.ok) return setError(res.error);
      setOk('Remise retirée.');
      onDone();
    });
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-5">
      <div>
        <h2 className="font-display text-lg italic">Remise sur un abonnement</h2>
        <p className="text-sm text-[color:var(--color-muted-foreground)]">
          Geste commercial : applique un coupon directement à l&apos;abonnement d&apos;une agence
          (effet sur les prochaines factures selon la durée du coupon).
        </p>
      </div>

      {orgs.length === 0 ? (
        <p className="text-sm text-[color:var(--color-muted-foreground)]">
          Aucune agence avec un abonnement Stripe pour le moment.
        </p>
      ) : coupons.length === 0 ? (
        <p className="text-sm text-[color:var(--color-muted-foreground)]">
          Crée d&apos;abord un coupon ci-dessous pour pouvoir l&apos;appliquer.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-[0.6875rem] font-semibold tracking-[0.08em] text-[color:var(--color-muted-foreground)] uppercase">
                Agence
              </span>
              <Select value={orgId} onValueChange={setOrgId}>
                <SelectTrigger className={inputCls}>
                  <SelectValue placeholder="Choisir une agence…" />
                </SelectTrigger>
                <SelectContent>
                  {orgs.map((o) => (
                    <SelectItem key={o._id} value={o._id}>
                      {o.name}
                      {o.subscriptionTier ? ` · ${o.subscriptionTier}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-[0.6875rem] font-semibold tracking-[0.08em] text-[color:var(--color-muted-foreground)] uppercase">
                Coupon
              </span>
              <Select value={couponId} onValueChange={setCouponId}>
                <SelectTrigger className={inputCls}>
                  <SelectValue placeholder="Choisir un coupon…" />
                </SelectTrigger>
                <SelectContent>
                  {coupons.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {(c.name ?? c.id) + ' — ' + couponValue(c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <div className="flex gap-2">
              <Button variant="primary" size="sm" type="button" onClick={apply} disabled={pending}>
                {pending ? '…' : 'Appliquer'}
              </Button>
              <Button variant="ghost" size="sm" type="button" onClick={remove} disabled={pending}>
                Retirer
              </Button>
            </div>
          </div>
          {error ? <p className="text-sm text-[color:var(--color-danger)]">{error}</p> : null}
          {ok ? <p className="text-sm text-[color:var(--color-success)]">{ok}</p> : null}
        </>
      )}
    </section>
  );
}

function CreateCouponDialog({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [kind, setKind] = useState<'percent' | 'amount' | 'trial'>('percent');
  const [percentOff, setPercentOff] = useState('20');
  const [amountOff, setAmountOff] = useState('10');
  const [currency, setCurrency] = useState<'EUR' | 'USD' | 'MAD'>('EUR');
  const [duration, setDuration] = useState<'once' | 'repeating' | 'forever'>('once');
  const [durationInMonths, setDurationInMonths] = useState('3');
  const [trialMonths, setTrialMonths] = useState('1');
  const [maxRedemptions, setMaxRedemptions] = useState('');
  const [redeemBy, setRedeemBy] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [restrictToPro, setRestrictToPro] = useState(false);

  function submit() {
    setError(null);
    if (!name.trim()) {
      setError('Le nom est requis.');
      return;
    }
    const input: CreateCouponInput =
      kind === 'trial'
        ? {
            name: name.trim(),
            kind: 'trial',
            // Un essai est un coupon 100 % récurrent ; la durée et la restriction
            // pros sont imposées côté serveur — on ne fait que porter les mois.
            duration: 'repeating',
            trialMonths: Number(trialMonths),
            restrictToProProducts: true,
            ...(maxRedemptions ? { maxRedemptions: Number(maxRedemptions) } : {}),
            ...(redeemBy ? { redeemBy: new Date(redeemBy).getTime() } : {}),
            ...(promoCode.trim() ? { promoCode: promoCode.trim().toUpperCase() } : {}),
          }
        : {
            name: name.trim(),
            kind,
            duration,
            ...(kind === 'percent' ? { percentOff: Number(percentOff) } : {}),
            ...(kind === 'amount'
              ? { amountOffMajor: Number(amountOff.replace(',', '.')), currency }
              : {}),
            ...(duration === 'repeating' ? { durationInMonths: Number(durationInMonths) } : {}),
            ...(maxRedemptions ? { maxRedemptions: Number(maxRedemptions) } : {}),
            ...(redeemBy ? { redeemBy: new Date(redeemBy).getTime() } : {}),
            ...(promoCode.trim() ? { promoCode: promoCode.trim().toUpperCase() } : {}),
            ...(restrictToPro ? { restrictToProProducts: true } : {}),
          };
    startTransition(async () => {
      const res = await adminCreateCouponAction(input);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      setName('');
      setPromoCode('');
      setRestrictToPro(false);
      onDone();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="primary" size="sm" type="button">
          Créer un coupon
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Créer un coupon</DialogTitle>
          <DialogDescription>
            La réduction s&apos;applique au paiement (couple ou pro) qui utilise le code, ou
            directement à un abonnement.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {/* Stripe refuse (400) un nom de plus de 40 caractères au lieu de le
              tronquer : on borne la saisie plutôt que de perdre le coupon. */}
          <Field label={`Nom interne (${name.length}/${STRIPE_COUPON_NAME_MAX_LENGTH})`}>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={STRIPE_COUPON_NAME_MAX_LENGTH}
              placeholder="Ex. Lancement -20%"
              className={inputCls}
            />
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:items-end">
            <Field label="Type">
              <Select
                value={kind}
                onValueChange={(v) => setKind(v as 'percent' | 'amount' | 'trial')}
              >
                <SelectTrigger className={inputCls}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percent">Pourcentage</SelectItem>
                  <SelectItem value="amount">Montant fixe</SelectItem>
                  <SelectItem value="trial">Mois offerts (essai)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {kind === 'percent' ? (
              <Field label="Réduction (%)">
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={percentOff}
                  onChange={(e) => setPercentOff(e.target.value)}
                  className={inputCls}
                />
              </Field>
            ) : kind === 'amount' ? (
              <Field label="Montant">
                <div className="flex gap-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={amountOff}
                    onChange={(e) => setAmountOff(e.target.value)}
                    className={inputCls}
                  />
                  <Select value={currency} onValueChange={(v) => setCurrency(v as typeof currency)}>
                    <SelectTrigger className={inputCls}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="EUR">EUR</SelectItem>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="MAD">MAD</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </Field>
            ) : (
              <Field label="Mois offerts">
                <input
                  type="number"
                  min={1}
                  max={24}
                  value={trialMonths}
                  onChange={(e) => setTrialMonths(e.target.value)}
                  className={inputCls}
                />
              </Field>
            )}
          </div>

          {kind !== 'trial' ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:items-end">
              <Field label="Durée (abonnements)">
                <Select value={duration} onValueChange={(v) => setDuration(v as typeof duration)}>
                  <SelectTrigger className={inputCls}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="once">Une fois</SelectItem>
                    <SelectItem value="repeating">Récurrent</SelectItem>
                    <SelectItem value="forever">Permanent</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {duration === 'repeating' ? (
                <Field label="Nombre de mois">
                  <input
                    type="number"
                    min={1}
                    value={durationInMonths}
                    onChange={(e) => setDurationInMonths(e.target.value)}
                    className={inputCls}
                  />
                </Field>
              ) : (
                <div />
              )}
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:items-end">
            <Field label="Max utilisations (optionnel)">
              <input
                type="number"
                min={1}
                value={maxRedemptions}
                onChange={(e) => setMaxRedemptions(e.target.value)}
                placeholder="illimité"
                className={inputCls}
              />
            </Field>
            <Field label="Expire le">
              <input
                type="date"
                value={redeemBy}
                onChange={(e) => setRedeemBy(e.target.value)}
                className={inputCls}
              />
            </Field>
          </div>

          <Field label="Code promo (optionnel — généré sinon)">
            <input
              type="text"
              value={promoCode}
              onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
              placeholder="Ex. BIENVENUE20"
              className={`${inputCls} font-mono`}
            />
          </Field>

          {kind === 'trial' ? (
            <p className="rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3 text-xs text-[color:var(--color-muted-foreground)]">
              Le pro saisit ce code au paiement de son abonnement et bénéficie de{' '}
              <span className="font-medium text-[color:var(--color-foreground)]">
                {trialMonths || '0'} mois à 0 €
              </span>
              , puis le tarif normal reprend automatiquement (carte enregistrée dès l&apos;essai).
              Réservé aux forfaits pros (Starter / Business / Agency) — sans effet sur les forfaits
              couples ni le PAYG.
            </p>
          ) : (
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3">
              <input
                type="checkbox"
                checked={restrictToPro}
                onChange={(e) => setRestrictToPro(e.target.checked)}
                className="mt-0.5 h-4 w-4 flex-shrink-0 accent-[color:var(--brand-500)]"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">Réserver aux forfaits pros</span>
                <span className="text-xs text-[color:var(--color-muted-foreground)]">
                  Limite la réduction aux abonnements pros (Starter / Business / Agency, mensuel
                  &amp; annuel). Ne s&apos;applique pas aux forfaits couples ni au PAYG.
                </span>
              </span>
            </label>
          )}
        </div>

        {error ? <p className="mt-3 text-sm text-[color:var(--color-danger)]">{error}</p> : null}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" size="sm" type="button" disabled={pending}>
              Annuler
            </Button>
          </DialogClose>
          <Button variant="primary" size="sm" type="button" onClick={submit} disabled={pending}>
            {pending ? 'Création…' : 'Créer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteCouponButton({ couponId, onDone }: { couponId: string; onDone: () => void }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      onClick={() =>
        startTransition(async () => {
          const res = await adminDeleteCouponAction(couponId);
          if (res.ok) onDone();
        })
      }
      disabled={pending}
      className="rounded-md px-2 py-1 text-xs font-medium text-[color:var(--color-danger)] transition-colors hover:bg-[color:var(--color-danger)]/10 disabled:opacity-50"
    >
      {pending ? '…' : 'Supprimer'}
    </button>
  );
}

function TogglePromoButton({
  id,
  active,
  onDone,
}: {
  id: string;
  active: boolean;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      onClick={() =>
        startTransition(async () => {
          const res = await adminSetPromotionCodeActiveAction(id, !active);
          if (res.ok) onDone();
        })
      }
      disabled={pending}
      className="rounded-md px-2 py-1 text-xs font-medium text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-surface-elevated)] hover:text-[color:var(--color-foreground)] disabled:opacity-50"
    >
      {pending ? '…' : active ? 'Désactiver' : 'Activer'}
    </button>
  );
}

const inputCls =
  'w-full rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2 text-sm text-[color:var(--color-foreground)] focus:ring-1 focus:ring-[color:var(--color-border-strong)] focus:outline-none';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[0.6875rem] font-semibold tracking-[0.08em] text-[color:var(--color-muted-foreground)] uppercase">
        {label}
      </span>
      {children}
    </label>
  );
}
