'use client';

import * as TabsPrimitive from '@radix-ui/react-tabs';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

/**
 * Tabs (shadcn/Radix) — variante « underline » plutôt que la pilule grise par
 * défaut : dans un back-office dense l'onglet actif doit se lire d'un coup d'œil
 * sans ajouter une deuxième surface par-dessus la carte qui les contient.
 */

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        'flex w-full items-center gap-1 overflow-x-auto border-b border-[color:var(--color-border)]',
        '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'focus-ring relative inline-flex h-10 shrink-0 items-center gap-2 rounded-t-lg px-3 text-sm font-medium whitespace-nowrap',
        'text-[color:var(--color-muted-foreground)] transition-colors',
        'hover:text-[color:var(--color-foreground)]',
        'disabled:pointer-events-none disabled:opacity-50',
        'data-[state=active]:text-[color:var(--color-foreground)]',
        // Le trait actif chevauche la bordure de la liste (-bottom-px).
        'after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-transparent',
        'data-[state=active]:after:bg-[color:var(--color-primary)]',
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn('focus-ring data-[state=active]:animate-fade-in mt-5', className)}
      {...props}
    />
  );
}
