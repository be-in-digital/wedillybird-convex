'use client';

import { useState, useTransition } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { Heart, X, HelpCircle, Check, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/cn';
import { analytics, track } from '@/lib/analytics/posthog-client';
import { EVENTS } from '@/lib/analytics/events';
import {
  normalizeRsvpConfig,
  type RsvpConfig,
  type RsvpQuestion,
  type CustomAnswer,
} from '@/lib/rsvp/questions';
import { submitRsvpAction, type RsvpActionResult } from '@/app/[locale]/i/[token]/actions';

type RsvpStatus = 'attending' | 'declined' | 'maybe';

interface Props {
  token: string;
  plusOnesAllowed: number;
  accentColor?: string;
  /** Config du formulaire (champs pilotés par le couple / l'agence). */
  config?: RsvpConfig | null;
  initial: {
    rsvpStatus: 'pending' | RsvpStatus;
    plusOnesNames?: string[];
    dietaryRestrictions?: string;
    notes?: string;
    customAnswers?: CustomAnswer[];
  };
  /**
   * `live` (défaut) : la réponse part vers Convex via `submitRsvpAction`.
   * `demo` : page `/demo` publique — aucune écriture, la réponse est acceptée
   * localement après un court délai pour que le visiteur vive le parcours
   * complet (confettis compris). Trace `demo_rsvp_submitted`, jamais
   * `rsvp_submitted`.
   */
  mode?: 'live' | 'demo';
}

/** Simule l'aller-retour serveur de la démo (ressenti réaliste, sans réseau). */
function submitDemo(): Promise<RsvpActionResult> {
  return new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 450));
}

const STATUS_OPTIONS: Array<{
  value: RsvpStatus;
  Icon: typeof Heart;
}> = [
  { value: 'attending', Icon: Heart },
  { value: 'maybe', Icon: HelpCircle },
  { value: 'declined', Icon: X },
];

/**
 * RSVP form V4 — refonte premium pour la page invitation publique.
 *
 * Les champs affichés sont pilotés par `config` (`events.rsvpConfig`) : le
 * couple / l'agence active, renomme les champs standard et ajoute des questions
 * custom typées. Les réponses custom sont sérialisées en JSON dans le champ
 * `customAnswers` (la mutation Convex re-valide de façon autoritaire).
 */
export function RsvpFormV4({
  token,
  plusOnesAllowed,
  accentColor,
  config,
  initial,
  mode = 'live',
}: Props) {
  const t = useTranslations('Invitation');
  const tCommon = useTranslations('Common');
  const reduced = useReducedMotion();
  const accent = accentColor ?? 'oklch(72% 0.09 20)';
  const cfg = normalizeRsvpConfig(config);

  const [status, setStatus] = useState<RsvpStatus | null>(
    initial.rsvpStatus === 'pending' ? null : initial.rsvpStatus,
  );
  const [names, setNames] = useState<string[]>(
    initial.plusOnesNames && initial.plusOnesNames.length > 0
      ? initial.plusOnesNames
      : Array(plusOnesAllowed).fill(''),
  );
  const [dietary, setDietary] = useState(initial.dietaryRestrictions ?? '');
  const [notes, setNotes] = useState(initial.notes ?? '');
  const [answers, setAnswers] = useState<Record<string, string[]>>(() => {
    const init: Record<string, string[]> = {};
    for (const a of initial.customAnswers ?? []) init[a.questionId] = a.values;
    return init;
  });
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | undefined>>({});
  const [success, setSuccess] = useState(initial.rsvpStatus !== 'pending');
  const [pending, startTransition] = useTransition();

  const showPlusOnes = cfg.askPlusOnes && plusOnesAllowed > 0;

  function setAnswer(id: string, values: string[]) {
    setAnswers((prev) => ({ ...prev, [id]: values }));
    setFieldErrors((prev) => ({ ...prev, [id]: undefined }));
  }

  function fireConfetti() {
    if (reduced) return;
    void (async () => {
      try {
        const confetti = (await import('canvas-confetti')).default;
        confetti({
          particleCount: 80,
          spread: 75,
          startVelocity: 35,
          scalar: 0.9,
          ticks: 140,
          origin: { y: 0.6 },
          colors: ['#f5d0c5', '#e8c5b4', '#d4b896', '#fbf6ee', '#c89788'],
          disableForReducedMotion: true,
        });
      } catch {
        // canvas-confetti non chargé : silent fail.
      }
    })();
  }

  function handleSubmit(formData: FormData) {
    setError(null);
    setFieldErrors({});
    if (!status) {
      setError(t('errors.pickStatus'));
      return;
    }

    // Questions applicables (les `onlyIfAttending` seulement si présent).
    const applicable = cfg.customQuestions.filter(
      (q) => !q.onlyIfAttending || status === 'attending',
    );
    const errs: Record<string, string> = {};
    for (const q of applicable) {
      if (q.required) {
        const vals = (answers[q.id] ?? []).filter((v) => v.trim().length > 0);
        if (vals.length === 0) errs[q.id] = t('errors.answerRequired');
      }
    }
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      setError(t('errors.answerRequired'));
      return;
    }

    formData.set('rsvpStatus', status);
    formData.delete('plusOnesNames');
    if (status === 'attending' && showPlusOnes) {
      for (const n of names) {
        if (n.trim().length > 0) formData.append('plusOnesNames', n.trim());
      }
    }

    const builtAnswers = applicable
      .map((q) => ({
        questionId: q.id,
        values: (answers[q.id] ?? []).map((v) => v.trim()).filter((v) => v.length > 0),
      }))
      .filter((a) => a.values.length > 0);
    formData.set('customAnswers', JSON.stringify(builtAnswers));

    startTransition(async () => {
      const result: RsvpActionResult =
        mode === 'demo' ? await submitDemo() : await submitRsvpAction(token, formData);
      if (result.ok) {
        setSuccess(true);
        // RSVP enregistré (boucle virale invité) — `status` non-null garanti ci-dessus.
        if (mode === 'demo') track(EVENTS.demoRsvpSubmitted, { status });
        else analytics.rsvpSubmitted({ status });
        if (status === 'attending') fireConfetti();
        return;
      }
      if (result.fieldErrors) {
        const flat: Record<string, string | undefined> = {};
        for (const [k, v] of Object.entries(result.fieldErrors)) {
          if (v && v.length > 0) flat[k] = v[0];
        }
        setFieldErrors(flat);
        return;
      }
      if (result.error === 'INVITATION_NOT_FOUND') setError(t('errors.notFound'));
      else if (result.error === 'EVENT_CLOSED') setError(t('errors.eventClosed'));
      else if (result.error === 'PLUS_ONES_EXCEEDED') setError(t('errors.plusOnesExceeded'));
      else if (result.error === 'CUSTOM_ANSWER_REQUIRED') setError(t('errors.answerRequired'));
      else setError(t('errors.unknown'));
    });
  }

  if (success) {
    return (
      <motion.div
        data-testid="rsvp-success"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="inv-card flex flex-col items-center gap-5 rounded-3xl border bg-[color:var(--color-surface)] p-8 text-center shadow-[var(--shadow-blush)]"
        style={{ borderColor: accent }}
      >
        <motion.span
          initial={{ scale: 0, rotate: -90 }}
          animate={{
            scale: 1,
            rotate: 0,
            transition: { type: 'spring', stiffness: 280, damping: 16 },
          }}
          className="flex h-14 w-14 items-center justify-center rounded-full text-white shadow-[var(--shadow-soft)]"
          style={{ background: accent }}
          aria-hidden
        >
          <Sparkles className="h-6 w-6" strokeWidth={1.75} />
        </motion.span>
        <p
          className="font-display text-balance italic"
          style={{
            fontSize: 'clamp(1.5rem, 2.6vw, 2rem)',
            lineHeight: 1.15,
            letterSpacing: '-0.018em',
            color: 'var(--color-ink-900)',
          }}
        >
          {t('thanks')}
        </p>
        <p className="max-w-sm text-sm leading-relaxed text-[color:var(--color-ink-500)] sm:text-base">
          {status === 'attending'
            ? t('thanksAttending')
            : status === 'declined'
              ? t('thanksDeclined')
              : t('thanksMaybe')}
        </p>
        <button
          type="button"
          onClick={() => setSuccess(false)}
          className="font-mono text-[10px] tracking-[0.32em] text-[color:var(--color-ink-500)] uppercase transition-colors hover:text-[color:var(--color-ink-900)]"
          data-testid="rsvp-change"
        >
          ← {t('changeAnswer')}
        </button>
      </motion.div>
    );
  }

  return (
    <form
      action={handleSubmit}
      className="inv-card flex flex-col gap-7 rounded-3xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-6 shadow-[var(--shadow-soft)] sm:p-8"
      data-testid="rsvp-form"
    >
      <fieldset className="flex flex-col gap-4">
        <legend
          className="font-display text-balance italic"
          style={{
            fontSize: 'clamp(1.25rem, 2vw, 1.625rem)',
            lineHeight: 1.2,
            letterSpacing: '-0.018em',
            color: 'var(--color-ink-900)',
          }}
        >
          {t('willYouAttend')}
        </legend>
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          {STATUS_OPTIONS.map(({ value, Icon }) => {
            const selected = status === value;
            return (
              <label
                key={value}
                className={cn(
                  'focus-ring group relative flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 px-3 py-5 text-center transition-all duration-200',
                  selected
                    ? 'shadow-[var(--shadow-blush)]'
                    : 'border-[color:var(--color-border)] hover:border-[color:var(--color-border-strong)]',
                )}
                style={selected ? { borderColor: accent } : undefined}
              >
                <input
                  type="radio"
                  name="rsvpStatus"
                  value={value}
                  checked={selected}
                  onChange={() => setStatus(value)}
                  className="sr-only"
                  data-testid={`rsvp-option-${value}`}
                />
                <span
                  aria-hidden
                  className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-full transition-colors',
                    selected ? 'text-white' : 'text-[color:var(--color-ink-500)]',
                  )}
                  style={
                    selected ? { background: accent } : { background: 'var(--color-ivory-100)' }
                  }
                >
                  <Icon
                    className="h-5 w-5"
                    strokeWidth={1.75}
                    fill={value === 'attending' && selected ? 'currentColor' : 'none'}
                  />
                </span>
                <span
                  className={cn(
                    'text-sm font-medium',
                    selected
                      ? 'text-[color:var(--color-ink-900)]'
                      : 'text-[color:var(--color-ink-700)]',
                  )}
                >
                  {t(`status.${value}`)}
                </span>
                <AnimatePresence>
                  {selected && (
                    <motion.span
                      key="check"
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{
                        scale: 1,
                        opacity: 1,
                        transition: { type: 'spring', stiffness: 320, damping: 18 },
                      }}
                      exit={{ scale: 0, opacity: 0 }}
                      aria-hidden
                      className="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full text-white"
                      style={{ background: accent }}
                    >
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </motion.span>
                  )}
                </AnimatePresence>
              </label>
            );
          })}
        </div>
      </fieldset>

      <AnimatePresence initial={false}>
        {status === 'attending' && showPlusOnes ? (
          <motion.fieldset
            key="plus-ones"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="flex flex-col gap-3"
          >
            <legend className="font-medium text-[color:var(--color-ink-900)]">
              {t('plusOnesLegend', { count: plusOnesAllowed })}
            </legend>
            <div className="flex flex-col gap-2">
              {Array.from({ length: plusOnesAllowed }).map((_, i) => (
                <Input
                  key={i}
                  name="plusOnesNames"
                  placeholder={t('plusOnePlaceholder', { index: i + 1 })}
                  value={names[i] ?? ''}
                  onChange={(e) => {
                    const next = [...names];
                    next[i] = e.target.value;
                    setNames(next);
                  }}
                  data-testid={`plus-one-${i}`}
                />
              ))}
            </div>
            {fieldErrors.plusOnesNames ? (
              <p className="text-xs text-[color:var(--color-destructive)]">
                {fieldErrors.plusOnesNames}
              </p>
            ) : null}
          </motion.fieldset>
        ) : null}

        {status === 'attending' && cfg.askDietary ? (
          <motion.div
            key="dietary"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="flex flex-col gap-2"
          >
            <Label htmlFor="dietaryRestrictions">{cfg.dietaryLabel ?? t('dietaryLabel')}</Label>
            <Input
              id="dietaryRestrictions"
              name="dietaryRestrictions"
              placeholder={t('dietaryPlaceholder')}
              value={dietary}
              onChange={(e) => setDietary(e.target.value)}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Questions personnalisées (couple / agence) */}
      {status
        ? cfg.customQuestions
            .filter((q) => !q.onlyIfAttending || status === 'attending')
            .map((q) => (
              <CustomQuestionField
                key={q.id}
                question={q}
                value={answers[q.id] ?? []}
                onChange={(v) => setAnswer(q.id, v)}
                error={fieldErrors[q.id]}
                accent={accent}
                yesLabel={t('booleanYes')}
                noLabel={t('booleanNo')}
                requiredLabel={t('requiredMark')}
              />
            ))
        : null}

      {cfg.askNotes ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="notes">{cfg.notesLabel ?? t('notesLabel')}</Label>
          <Input
            id="notes"
            name="notes"
            placeholder={t('notesPlaceholder')}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      ) : null}

      {error ? (
        <p id="rsvp-error" role="alert" className="text-sm text-[color:var(--color-destructive)]">
          {error}
        </p>
      ) : null}

      <Button type="submit" size="lg" disabled={pending} data-testid="submit-rsvp">
        {pending ? tCommon('loading') : t('submit')}
      </Button>
    </form>
  );
}

/** Rendu d'une question custom selon son type. Contrôlé (valeurs en `string[]`). */
function CustomQuestionField({
  question,
  value,
  onChange,
  error,
  accent,
  yesLabel,
  noLabel,
  requiredLabel,
}: {
  question: RsvpQuestion;
  value: string[];
  onChange: (values: string[]) => void;
  error?: string;
  accent: string;
  yesLabel: string;
  noLabel: string;
  requiredLabel: string;
}) {
  const { type, label, options = [] } = question;
  const single = value[0] ?? '';

  const legend = (
    <span className="font-medium text-[color:var(--color-ink-900)]">
      {label}
      {question.required ? (
        <span className="ml-1 text-[color:var(--color-blush-700)]" aria-label={requiredLabel}>
          *
        </span>
      ) : null}
    </span>
  );

  const pill = (selected: boolean) =>
    cn(
      'focus-ring cursor-pointer rounded-full border px-4 py-2 text-sm transition-all',
      selected
        ? 'font-medium text-[color:var(--color-ink-900)] shadow-[var(--shadow-blush)]'
        : 'border-[color:var(--color-border)] text-[color:var(--color-ink-700)] hover:border-[color:var(--color-border-strong)]',
    );

  return (
    <fieldset className="flex flex-col gap-2.5">
      <legend className="mb-1">{legend}</legend>

      {type === 'short_text' ? (
        <Input
          value={single}
          onChange={(e) => onChange([e.target.value])}
          aria-invalid={!!error}
          aria-label={label}
        />
      ) : null}

      {type === 'long_text' ? (
        <textarea
          value={single}
          onChange={(e) => onChange([e.target.value])}
          aria-invalid={!!error}
          aria-label={label}
          rows={3}
          className="focus-ring w-full rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 py-2.5 text-sm text-[color:var(--color-foreground)] placeholder:text-[color:var(--color-muted-foreground)]"
        />
      ) : null}

      {type === 'boolean' ? (
        <div className="flex gap-2">
          {[
            { v: 'yes', l: yesLabel },
            { v: 'no', l: noLabel },
          ].map(({ v, l }) => {
            const selected = single === v;
            return (
              <button
                key={v}
                type="button"
                onClick={() => onChange([v])}
                className={pill(selected)}
                style={selected ? { borderColor: accent } : undefined}
                aria-pressed={selected}
              >
                {l}
              </button>
            );
          })}
        </div>
      ) : null}

      {type === 'single_choice' ? (
        <div className="flex flex-wrap gap-2">
          {options.map((opt) => {
            const selected = single === opt;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => onChange([opt])}
                className={pill(selected)}
                style={selected ? { borderColor: accent } : undefined}
                aria-pressed={selected}
              >
                {opt}
              </button>
            );
          })}
        </div>
      ) : null}

      {type === 'multi_choice' ? (
        <div className="flex flex-wrap gap-2">
          {options.map((opt) => {
            const selected = value.includes(opt);
            return (
              <button
                key={opt}
                type="button"
                onClick={() =>
                  onChange(selected ? value.filter((v) => v !== opt) : [...value, opt])
                }
                className={pill(selected)}
                style={selected ? { borderColor: accent } : undefined}
                aria-pressed={selected}
              >
                {opt}
              </button>
            );
          })}
        </div>
      ) : null}

      {error ? <p className="text-xs text-[color:var(--color-destructive)]">{error}</p> : null}
    </fieldset>
  );
}
