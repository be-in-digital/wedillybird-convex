import type { ComponentType, ReactNode } from 'react';
import { AlertTriangle, Ban, CheckCircle2, Circle, Clock, RotateCcw, XCircle } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Pastille de statut. Une couleur seule ne suffit pas à encoder un état
 * (daltonisme, impression N&B, capture d'écran désaturée) : chaque ton porte
 * donc aussi une icône.
 */

export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'progress';

const TONE_ICON: Record<StatusTone, ComponentType<{ className?: string; strokeWidth?: number }>> = {
  neutral: Circle,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
  info: RotateCcw,
  progress: Clock,
};

const TONE_CLASS: Record<StatusTone, string> = {
  neutral:
    'bg-[color:var(--color-surface-elevated)] text-[color:var(--color-muted-foreground)] ring-[color:var(--color-border)]',
  success:
    'bg-[color:var(--color-success-soft)] text-[color:color-mix(in_oklab,var(--color-success),var(--color-foreground)_42%)] ring-transparent',
  warning:
    'bg-[color:var(--color-warning-soft)] text-[color:color-mix(in_oklab,var(--color-warning),var(--color-foreground)_55%)] ring-transparent',
  danger:
    'bg-[color:var(--color-danger-soft)] text-[color:color-mix(in_oklab,var(--color-danger),var(--color-foreground)_40%)] ring-transparent',
  info: 'bg-[color:var(--color-info-soft)] text-[color:color-mix(in_oklab,var(--color-info),var(--color-foreground)_40%)] ring-transparent',
  progress:
    'bg-[color:var(--color-accent-soft)] text-[color:color-mix(in_oklab,var(--color-accent),var(--color-foreground)_30%)] ring-transparent',
};

export function StatusPill({
  tone = 'neutral',
  children,
  icon,
  className,
}: {
  tone?: StatusTone;
  children: ReactNode;
  /** `null` retire l'icône — pour les pastilles purement typographiques (plan, devise). */
  icon?: ComponentType<{ className?: string; strokeWidth?: number }> | null;
  className?: string;
}) {
  const Icon = icon === null ? null : (icon ?? TONE_ICON[tone]);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset',
        TONE_CLASS[tone],
        className,
      )}
    >
      {Icon ? <Icon className="h-3 w-3 shrink-0" strokeWidth={2.25} /> : null}
      {children}
    </span>
  );
}

export { Ban as StatusBanIcon };
