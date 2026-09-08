'use client';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';
import { useUiTheme } from './theme-provider';

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Content>) {
  const theme = useUiTheme();
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-theme={theme === 'dark' ? 'dark' : undefined}
        sideOffset={sideOffset}
        className={cn(
          'z-50 max-w-xs rounded-lg border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface-elevated)]',
          'px-2.5 py-1.5 text-xs text-[color:var(--color-foreground)] shadow-[var(--shadow-popover)]',
          'data-[state=delayed-open]:animate-fade-in',
          className,
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}
