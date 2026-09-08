'use client';

import { Command as CommandPrimitive } from 'cmdk';
import { Search } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog';

/**
 * Command (shadcn / cmdk) — palette de commandes. Utilisée par le back-office
 * admin (⌘K) pour sauter d'une section à l'autre sans revenir à la sidebar.
 */

export function Command({ className, ...props }: ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      className={cn(
        'flex h-full w-full flex-col overflow-hidden rounded-xl bg-[color:var(--color-surface)] text-[color:var(--color-foreground)]',
        className,
      )}
      {...props}
    />
  );
}

export function CommandDialog({
  children,
  className,
  title,
  description,
  ...props
}: ComponentProps<typeof Dialog> & {
  className?: string;
  /** Nom de la palette pour les lecteurs d'écran — le champ seul ne la nomme pas. */
  title: string;
  description?: ReactNode;
}) {
  return (
    <Dialog {...props}>
      <DialogContent
        showClose={false}
        className={cn(
          'top-[12vh] max-w-xl translate-y-0 p-0 [&>div]:overflow-visible [&>div]:p-0',
          className,
        )}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        {description ? (
          <DialogDescription className="sr-only">{description}</DialogDescription>
        ) : null}
        <Command loop>{children}</Command>
      </DialogContent>
    </Dialog>
  );
}

export function CommandInput({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div className="flex items-center gap-2 border-b border-[color:var(--color-border)] px-4">
      <Search
        className="h-4 w-4 shrink-0 text-[color:var(--color-muted-foreground)]"
        strokeWidth={2}
        aria-hidden
      />
      <CommandPrimitive.Input
        className={cn(
          'h-12 w-full bg-transparent text-sm outline-none placeholder:text-[color:var(--color-muted-foreground)]',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
    </div>
  );
}

export function CommandList({ className, ...props }: ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      className={cn('max-h-[min(24rem,60dvh)] overflow-x-hidden overflow-y-auto p-2', className)}
      {...props}
    />
  );
}

export function CommandEmpty(props: ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      className="py-8 text-center text-sm text-[color:var(--color-muted-foreground)]"
      {...props}
    />
  );
}

export function CommandGroup({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      className={cn(
        'overflow-hidden text-[color:var(--color-foreground)]',
        '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1.5',
        '[&_[cmdk-group-heading]]:text-[0.6875rem] [&_[cmdk-group-heading]]:font-semibold',
        '[&_[cmdk-group-heading]]:tracking-[0.08em] [&_[cmdk-group-heading]]:text-[color:var(--color-muted-foreground)] [&_[cmdk-group-heading]]:uppercase',
        className,
      )}
      {...props}
    />
  );
}

export function CommandItem({ className, ...props }: ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      className={cn(
        'relative flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-sm outline-none select-none',
        'data-[selected=true]:bg-[color:var(--color-surface-elevated)]',
        'data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50',
        '[&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0 [&_svg]:text-[color:var(--color-muted-foreground)]',
        className,
      )}
      {...props}
    />
  );
}

export function CommandSeparator({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      className={cn('-mx-2 my-1 h-px bg-[color:var(--color-border)]', className)}
      {...props}
    />
  );
}

export function CommandShortcut({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'ml-auto font-mono text-[0.6875rem] tracking-widest text-[color:var(--color-muted-foreground)]',
        className,
      )}
      {...props}
    />
  );
}
