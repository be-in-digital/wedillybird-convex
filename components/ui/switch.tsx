'use client';

import * as SwitchPrimitive from '@radix-ui/react-switch';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'focus-ring inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full border border-transparent',
        'transition-colors duration-200 ease-[var(--ease-out-quint)]',
        'bg-[color:var(--color-border-strong)] data-[state=checked]:bg-[color:var(--color-primary)]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block h-5 w-5 rounded-full bg-[color:var(--color-surface)] shadow-sm',
          'transition-transform duration-200 ease-[var(--ease-out-quint)]',
          'translate-x-0.5 data-[state=checked]:translate-x-[1.125rem]',
        )}
      />
    </SwitchPrimitive.Root>
  );
}
