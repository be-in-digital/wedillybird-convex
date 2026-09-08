'use client';

import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check, Minus } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

export function Checkbox({ className, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        'focus-ring peer inline-flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-[0.3rem]',
        'border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)] transition-colors',
        'hover:border-[color:var(--color-primary)]',
        'data-[state=checked]:border-[color:var(--color-primary)] data-[state=checked]:bg-[color:var(--color-primary)]',
        'data-[state=indeterminate]:border-[color:var(--color-primary)] data-[state=indeterminate]:bg-[color:var(--color-primary)]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="text-[color:var(--color-primary-foreground)]">
        {props.checked === 'indeterminate' ? (
          <Minus className="h-3 w-3" strokeWidth={3} aria-hidden />
        ) : (
          <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
