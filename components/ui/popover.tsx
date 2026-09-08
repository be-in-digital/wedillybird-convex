'use client';

import * as PopoverPrimitive from '@radix-ui/react-popover';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';
import { useUiTheme } from './theme-provider';

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

export function PopoverContent({
  className,
  align = 'start',
  sideOffset = 6,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>) {
  const theme = useUiTheme();
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-theme={theme === 'dark' ? 'dark' : undefined}
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-50 w-72 rounded-xl border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)]',
          'p-3 text-[color:var(--color-foreground)] shadow-[var(--shadow-popover)]',
          'data-[state=open]:animate-scale-in',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
