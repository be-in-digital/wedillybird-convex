'use client';

import { useMemo, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectLabel,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/cn';
import { createEventAction } from '@/app/[locale]/(app)/events/actions';
import { PLANS, formatAmount } from '@/lib/payments/plans';
import { US_STATES, CA_PROVINCES, NOT_APPLICABLE_STATE_ID } from '@/lib/geo/regions';

type StepIndex = 0 | 1 | 2 | 3 | 4;

type PendingPlanTier = 'essential' | 'premium';

interface FormState {
  title: string;
  partnerA: string;
  partnerB: string;
  eventDate: string;
  timezone: string;
  venueName: string;
  venueAddress: string;
  weddingState: string;
  themePrimary: string;
  themeAccent: string;
  themeFont: string;
  pendingPlanTier: PendingPlanTier | null;
}

const TIMEZONES: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'Europe/Paris', label: 'Europe/Paris (UTC+1/+2)' },
  { id: 'Africa/Dakar', label: 'Africa/Dakar (UTC+0)' },
  { id: 'Africa/Abidjan', label: 'Africa/Abidjan (UTC+0)' },
  { id: 'Africa/Casablanca', label: 'Africa/Casablanca (UTC+1)' },
  { id: 'Africa/Algiers', label: 'Africa/Algiers (UTC+1)' },
  { id: 'Africa/Tunis', label: 'Africa/Tunis (UTC+1)' },
  { id: 'Africa/Douala', label: 'Africa/Douala (UTC+1)' },
  { id: 'Indian/Antananarivo', label: 'Indian/Antananarivo (UTC+3)' },
  { id: 'Indian/Mauritius', label: 'Indian/Mauritius (UTC+4)' },
];

const FONT_OPTIONS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'Playfair Display', label: 'Playfair Display' },
  { id: 'Cormorant Garamond', label: 'Cormorant Garamond' },
  { id: 'Inter', label: 'Inter' },
  { id: 'Manrope', label: 'Manrope' },
];

const DEFAULT_THEME = {
  primaryColor: '#C4996C',
  accentColor: '#2B2B2B',
  fontFamily: 'Playfair Display',
};

function detectInitialTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (TIMEZONES.some((t) => t.id === tz)) return tz;
  } catch {}
  return 'Europe/Paris';
}

interface Props {
  /**
   * L'événement va-t-il appartenir à une **organisation** ?
   *
   * C'est ce critère, et non le rôle, qui décide de l'étape « Choisir le
   * forfait » : `createEventAction` rattache l'event dès que
   * `myOrganization` répond, et `decidePublishGate` ne réclame jamais de
   * `planTier` à un event porteur d'`organizationId`. Décider sur le rôle
   * laissait un écart — un `pro` sans organisation sautait l'étape puis se
   * heurtait au mur du forfait à la publication.
   */
  hasOrganization?: boolean;
}

export function EventCreateWizard({ hasOrganization = false }: Props) {
  const t = useTranslations('EventCreate');
  const tCommon = useTranslations('Common');
  const tPlans = useTranslations('Plans');
  const tEvents = useTranslations('Events');
  const tPrivacy = useTranslations('FaceSearchPrivacy');
  const showPlanStep = !hasOrganization;
  const totalSteps = showPlanStep ? 5 : 4;
  const [step, setStep] = useState<StepIndex>(0);
  const [form, setForm] = useState<FormState>({
    title: '',
    partnerA: '',
    partnerB: '',
    eventDate: '',
    timezone: detectInitialTimezone(),
    venueName: '',
    venueAddress: '',
    weddingState: NOT_APPLICABLE_STATE_ID,
    themePrimary: DEFAULT_THEME.primaryColor,
    themeAccent: DEFAULT_THEME.accentColor,
    themeFont: DEFAULT_THEME.fontFamily,
    pendingPlanTier: null,
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | undefined>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const lastStepIndex = (totalSteps - 1) as StepIndex;
  const isPlanStep = showPlanStep && step === lastStepIndex;

  const canProceed = useMemo(() => {
    if (step === 0) {
      return (
        form.title.trim().length >= 2 &&
        form.partnerA.trim().length >= 1 &&
        form.partnerB.trim().length >= 1
      );
    }
    if (step === 1) {
      if (!form.eventDate || !form.timezone) return false;
      return !Number.isNaN(Date.parse(form.eventDate));
    }
    if (showPlanStep && step === lastStepIndex) {
      return form.pendingPlanTier !== null;
    }
    return true;
  }, [step, form, showPlanStep, lastStepIndex]);

  function submit() {
    setError(null);
    const fd = new FormData();
    fd.set('title', form.title.trim());
    fd.set('partnerA', form.partnerA.trim());
    fd.set('partnerB', form.partnerB.trim());
    fd.set('eventDate', form.eventDate);
    fd.set('timezone', form.timezone);
    if (form.venueName.trim() && form.venueAddress.trim()) {
      fd.set('venueName', form.venueName.trim());
      fd.set('venueAddress', form.venueAddress.trim());
    }
    if (form.weddingState !== NOT_APPLICABLE_STATE_ID) {
      fd.set('weddingState', form.weddingState);
    }
    if (form.themePrimary && form.themeAccent && form.themeFont) {
      fd.set('themePrimary', form.themePrimary);
      fd.set('themeAccent', form.themeAccent);
      fd.set('themeFont', form.themeFont);
    }
    if (showPlanStep && form.pendingPlanTier) {
      fd.set('pendingPlanTier', form.pendingPlanTier);
    }

    startTransition(async () => {
      const result = await createEventAction(fd);
      if (!result || result.ok) return;
      if (result.fieldErrors) {
        const flat: Record<string, string | undefined> = {};
        for (const [k, v] of Object.entries(result.fieldErrors)) {
          if (v && v.length > 0) flat[k] = v[0];
        }
        setFieldErrors(flat);
        if (flat.title || flat.partnerA || flat.partnerB) setStep(0);
        else if (flat.eventDate || flat.timezone) setStep(1);
        return;
      }
      setError(t('errors.submit'));
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <Progress
        current={step}
        total={totalSteps}
        label={tEvents('wizardProgress', { current: step + 1, total: totalSteps })}
      />

      {step === 0 ? (
        <section className="flex flex-col gap-5">
          <StepHeader title={t('stepCouple')} description={t('stepCoupleDescription')} />

          <Field
            label={t('titleLabel')}
            id="title"
            value={form.title}
            error={fieldErrors.title}
            placeholder={t('titlePlaceholder')}
            onChange={(v) => setForm({ ...form, title: v })}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label={t('partnerALabel')}
              id="partnerA"
              value={form.partnerA}
              error={fieldErrors.partnerA}
              onChange={(v) => setForm({ ...form, partnerA: v })}
            />
            <Field
              label={t('partnerBLabel')}
              id="partnerB"
              value={form.partnerB}
              error={fieldErrors.partnerB}
              onChange={(v) => setForm({ ...form, partnerB: v })}
            />
          </div>
        </section>
      ) : null}

      {step === 1 ? (
        <section className="flex flex-col gap-5">
          <StepHeader title={t('stepDate')} description={t('stepDateDescription')} />

          <Field
            label={t('dateLabel')}
            id="eventDate"
            type="datetime-local"
            value={form.eventDate}
            error={fieldErrors.eventDate}
            onChange={(v) => setForm({ ...form, eventDate: v })}
          />

          <div className="flex flex-col gap-2">
            <Label htmlFor="timezone">{t('timezoneLabel')}</Label>
            <Select
              name="timezone"
              value={form.timezone}
              onValueChange={(v) => setForm({ ...form, timezone: v })}
            >
              <SelectTrigger
                id="timezone"
                className="focus-ring h-11 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-sm"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMEZONES.map((tz) => (
                  <SelectItem key={tz.id} value={tz.id}>
                    {tz.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fieldErrors.timezone ? (
              <p className="text-xs text-[color:var(--color-destructive)]">
                {fieldErrors.timezone}
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="flex flex-col gap-5">
          <StepHeader title={t('stepVenue')} description={t('stepVenueDescription')} />

          <Field
            label={t('venueNameLabel')}
            id="venueName"
            value={form.venueName}
            placeholder={t('venueNamePlaceholder')}
            error={fieldErrors.venueName}
            onChange={(v) => setForm({ ...form, venueName: v })}
          />
          <Field
            label={t('venueAddressLabel')}
            id="venueAddress"
            value={form.venueAddress}
            placeholder={t('venueAddressPlaceholder')}
            error={fieldErrors.venueAddress}
            onChange={(v) => setForm({ ...form, venueAddress: v })}
          />

          <div className="flex flex-col gap-2">
            <Label htmlFor="weddingState">{tPrivacy('stateLabel')}</Label>
            <Select
              name="weddingState"
              value={form.weddingState}
              onValueChange={(v) => setForm({ ...form, weddingState: v })}
            >
              <SelectTrigger
                id="weddingState"
                className="focus-ring h-11 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-sm"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NOT_APPLICABLE_STATE_ID}>
                  {tPrivacy('stateNotApplicable')}
                </SelectItem>
                <SelectGroup>
                  <SelectLabel>{tPrivacy('stateGroupUs')}</SelectLabel>
                  {US_STATES.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel>{tPrivacy('stateGroupCa')}</SelectLabel>
                  {CA_PROVINCES.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <p className="text-xs text-[color:var(--color-muted)]">{tPrivacy('stateHint')}</p>
          </div>
        </section>
      ) : null}

      {step === 3 ? (
        <section className="flex flex-col gap-5">
          <StepHeader title={t('stepTheme')} description={t('stepThemeDescription')} />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <ColorField
              label={t('primaryColorLabel')}
              id="themePrimary"
              value={form.themePrimary}
              onChange={(v) => setForm({ ...form, themePrimary: v })}
            />
            <ColorField
              label={t('accentColorLabel')}
              id="themeAccent"
              value={form.themeAccent}
              onChange={(v) => setForm({ ...form, themeAccent: v })}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="themeFont">{t('fontFamilyLabel')}</Label>
            <Select
              name="themeFont"
              value={form.themeFont}
              onValueChange={(v) => setForm({ ...form, themeFont: v })}
            >
              <SelectTrigger
                id="themeFont"
                className="focus-ring h-11 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-sm"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FONT_OPTIONS.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </section>
      ) : null}

      {isPlanStep ? (
        <section className="flex flex-col gap-5">
          <StepHeader title={t('stepPlan')} description={t('stepPlanDescription')} />

          <div role="radiogroup" aria-label={t('stepPlan')} className="flex flex-col gap-3">
            {(['essential', 'premium'] as const).map((tier) => {
              const plan = PLANS[tier];
              const selected = form.pendingPlanTier === tier;
              return (
                <button
                  key={tier}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  data-testid={`plan-option-${tier}`}
                  onClick={() => setForm({ ...form, pendingPlanTier: tier })}
                  className={cn(
                    'focus-ring flex flex-col gap-3 rounded-2xl border p-5 text-left transition-all duration-200',
                    selected
                      ? 'border-[color:var(--color-blush-400)] bg-[color:var(--color-blush-50)] shadow-[var(--shadow-blush)]'
                      : 'border-[color:var(--color-border)] bg-white hover:border-[color:var(--color-blush-300)]',
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="font-display text-xl font-semibold">
                        {tPlans(`tiers.${tier}`)}
                      </span>
                      {selected ? (
                        <span
                          aria-hidden
                          className="flex h-5 w-5 items-center justify-center rounded-full bg-[color:var(--color-blush-700)] text-white"
                        >
                          <Check className="h-3 w-3" strokeWidth={3} />
                        </span>
                      ) : null}
                    </div>
                    <span className="font-display text-lg font-semibold">
                      {formatAmount(plan.prices.EUR, 'EUR')}
                    </span>
                  </div>
                  <p className="text-xs text-[color:var(--color-muted)]">
                    {tPlans(`retentionShort`, { days: plan.galleryRetentionDays })}
                  </p>
                  <ul className="flex flex-col gap-1.5 text-sm">
                    {plan.featureKeys.map((key) => (
                      <li key={key} className="flex items-start gap-1.5">
                        <span aria-hidden className="mt-0.5 text-[color:var(--color-accent)]">
                          ✓
                        </span>
                        <span>{tPlans(`features.${key}` as const)}</span>
                      </li>
                    ))}
                  </ul>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-[color:var(--color-muted)]">{t('stepPlanLegal')}</p>
        </section>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-[color:var(--color-destructive)]">
          {error}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <Button
          variant="ghost"
          type="button"
          onClick={() => setStep(Math.max(0, step - 1) as StepIndex)}
          disabled={pending || step === 0}
        >
          {tCommon('back')}
        </Button>
        {step < lastStepIndex ? (
          <Button
            size="lg"
            onClick={() => setStep(Math.min(lastStepIndex, step + 1) as StepIndex)}
            disabled={!canProceed}
          >
            {t('next')}
          </Button>
        ) : (
          <Button size="lg" onClick={submit} disabled={pending || !canProceed}>
            {pending ? t('creating') : t('submit')}
          </Button>
        )}
      </div>
    </div>
  );
}

function StepHeader({ title, description }: { title: string; description: string }) {
  return (
    <header className="flex flex-col gap-1.5">
      <h2 className="font-display text-2xl font-semibold">{title}</h2>
      <p className="text-sm text-[color:var(--color-muted)]">{description}</p>
    </header>
  );
}

function Field({
  label,
  id,
  value,
  onChange,
  error,
  placeholder,
  type = 'text',
}: {
  label: string;
  id: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={id}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={!!error}
      />
      {error ? <p className="text-xs text-[color:var(--color-destructive)]">{error}</p> : null}
    </div>
  );
}

function ColorField({
  label,
  id,
  value,
  onChange,
}: {
  label: string;
  id: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-3">
        <input
          id={id}
          name={id}
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-11 w-14 cursor-pointer rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)]"
        />
        <Input value={value.toUpperCase()} onChange={(e) => onChange(e.target.value)} />
      </div>
    </div>
  );
}

function Progress({ current, total, label }: { current: number; total: number; label: string }) {
  return (
    <div className="flex items-center gap-2" aria-label={label}>
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={cn(
            'h-1.5 flex-1 rounded-full',
            i <= current ? 'bg-[color:var(--color-primary)]' : 'bg-[color:var(--color-border)]',
          )}
        />
      ))}
    </div>
  );
}
