'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { useTranslations } from 'next-intl';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useUiTheme } from './theme-provider';

/**
 * Sheet (shadcn) — panneau latéral. Le projet a déjà `Drawer` (vaul, tiroir
 * mobile qui se tire au doigt) ; `Sheet` couvre l'autre besoin : un panneau
 * ancré à un bord, utilisé ici pour la navigation admin sur mobile et pour les
 * éditions rapides (DESIGN.md §9, « sheet latéral »).
 */

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

const sheetVariants = cva(
  cn(
    'fixed z-50 flex flex-col gap-0 border-[color:var(--color-border)] bg-[color:var(--color-surface)]',
    'text-[color:var(--color-foreground)] shadow-[var(--shadow-popover)] focus:outline-none',
    'transition-transform duration-300 ease-[var(--ease-out-quint)]',
  ),
  {
    variants: {
      side: {
        left: 'inset-y-0 left-0 h-full w-[86vw] max-w-xs border-r data-[state=closed]:-translate-x-full',
        right:
          'inset-y-0 right-0 h-full w-[86vw] max-w-md border-l data-[state=closed]:translate-x-full',
        top: 'inset-x-0 top-0 max-h-[85dvh] border-b data-[state=closed]:-translate-y-full',
        bottom: 'inset-x-0 bottom-0 max-h-[85dvh] border-t data-[state=closed]:translate-y-full',
      },
    },
    defaultVariants: { side: 'right' },
  },
);

export function SheetContent({
  className,
  children,
  side = 'right',
  showClose = true,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> &
  VariantProps<typeof sheetVariants> & { showClose?: boolean }) {
  const t = useTranslations('Common');
  const theme = useUiTheme();
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="animate-fade-in fixed inset-0 z-50 bg-black/55 backdrop-blur-sm" />
      <DialogPrimitive.Content
        data-theme={theme === 'dark' ? 'dark' : undefined}
        className={cn(sheetVariants({ side }), className)}
        {...props}
      >
        {children}
        {showClose ? (
          <DialogPrimitive.Close
            aria-label={t('close')}
            className="focus-ring absolute top-3 right-3 rounded-lg p-2.5 text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-surface-elevated)] hover:text-[color:var(--color-foreground)]"
          >
            <X className="h-4 w-4" strokeWidth={2} aria-hidden />
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function SheetHeader({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1 border-b border-[color:var(--color-border)] px-5 py-4 pr-14',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SheetTitle({ className, children }: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn('font-display text-lg text-[color:var(--color-foreground)] italic', className)}
    >
      {children}
    </DialogPrimitive.Title>
  );
}

export function SheetDescription({
  className,
  children,
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn('text-sm text-[color:var(--color-muted-foreground)]', className)}
    >
      {children}
    </DialogPrimitive.Description>
  );
}

export function SheetFooter({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        'mt-auto flex items-center justify-end gap-2 border-t border-[color:var(--color-border)] px-5 py-4',
        className,
      )}
    >
      {children}
    </div>
  );
}
