'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useUiTheme } from './theme-provider';

/**
 * Dialog (shadcn/Radix) — **le** pattern modal du projet. À utiliser pour toute
 * interaction en surimpression (confirmation, formulaire, aperçu, choix). Thémé
 * tokens OKLCH → dark agence + light éditorial. API alignée sur `Drawer` pour
 * substitution directe : Dialog / DialogContent / DialogHeader / DialogTitle.
 */

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  showClose = true,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & { showClose?: boolean }) {
  const t = useTranslations('Common');
  // Le portail sort du wrapper `data-theme` du shell → on réapplique le thème du
  // sous-arbre (dark agence / light couple) via le contexte, qui traverse le portail.
  const theme = useUiTheme();
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="animate-fade-in fixed inset-0 z-50 bg-black/55 backdrop-blur-sm" />
      <DialogPrimitive.Content
        data-theme={theme === 'dark' ? 'dark' : undefined}
        className={cn(
          // La couleur de texte doit être POSÉE ici. Le contenu est portalisé
          // vers `<body>` : `data-theme` ci-dessus redéfinit bien les tokens pour
          // les descendants, mais un texte sans `color` déclaré hérite, lui, de la
          // couleur calculée du `<body>` — restée en thème clair. Sans cette
          // classe, tout texte non colorisé explicitement s'affichait en charbon
          // sur le charbon des modales du back-office.
          'animate-scale-in fixed top-1/2 left-1/2 z-50 flex max-h-[90dvh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)] text-[color:var(--color-foreground)] shadow-[var(--shadow-popover)] focus:outline-none',
          className,
        )}
        {...props}
      >
        <div className="flex flex-col overflow-y-auto p-6">{children}</div>
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

export function DialogHeader({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('mb-4 flex flex-col gap-1 pr-8 text-left', className)}>{children}</div>;
}

export function DialogFooter({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('mt-5 flex items-center justify-end gap-2', className)}>{children}</div>
  );
}

export function DialogTitle({ className, children }: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn('font-display text-xl text-[color:var(--color-foreground)] italic', className)}
    >
      {children}
    </DialogPrimitive.Title>
  );
}

export function DialogDescription({
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
