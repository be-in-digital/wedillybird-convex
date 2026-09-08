import type { ComponentType, ReactNode } from 'react';
import { Inbox } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * État vide du back-office. Un tableau sans lignes rendait jusqu'ici un `<tbody>`
 * vide — l'admin ne savait pas s'il n'y avait rien ou si le filtre était trop
 * strict. On distingue donc les deux cas côté appelant via `description`.
 */
export function AdminEmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
  compact = false,
}: {
  icon?: ComponentType<{ className?: string; strokeWidth?: number; 'aria-hidden'?: boolean }>;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 text-center',
        compact ? 'py-10' : 'py-16',
        className,
      )}
    >
      <span
        aria-hidden
        className="flex h-11 w-11 items-center justify-center rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] text-[color:var(--color-muted-foreground)]"
      >
        <Icon className="h-5 w-5" strokeWidth={1.5} />
      </span>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-[color:var(--color-foreground)]">{title}</p>
        {description ? (
          <p className="mx-auto max-w-sm text-sm text-[color:var(--color-muted-foreground)]">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
