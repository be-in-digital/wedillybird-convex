import { ChevronRight } from 'lucide-react';
import { Slot } from '@radix-ui/react-slot';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

export function Breadcrumb({ className, ...props }: ComponentProps<'nav'>) {
  return <nav aria-label="Fil d'Ariane" className={cn('min-w-0', className)} {...props} />;
}

export function BreadcrumbList({ className, ...props }: ComponentProps<'ol'>) {
  return (
    <ol
      className={cn(
        'flex min-w-0 flex-wrap items-center gap-1.5 text-sm text-[color:var(--color-muted-foreground)]',
        className,
      )}
      {...props}
    />
  );
}

export function BreadcrumbItem({ className, ...props }: ComponentProps<'li'>) {
  return <li className={cn('inline-flex min-w-0 items-center gap-1.5', className)} {...props} />;
}

export function BreadcrumbLink({
  className,
  asChild,
  ...props
}: ComponentProps<'a'> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'a';
  return (
    <Comp
      className={cn(
        'focus-ring rounded-sm transition-colors hover:text-[color:var(--color-foreground)]',
        className,
      )}
      {...props}
    />
  );
}

export function BreadcrumbPage({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      aria-current="page"
      className={cn('truncate font-medium text-[color:var(--color-foreground)]', className)}
      {...props}
    />
  );
}

export function BreadcrumbSeparator({ className, children, ...props }: ComponentProps<'li'>) {
  return (
    <li role="presentation" aria-hidden className={cn('opacity-60', className)} {...props}>
      {children ?? <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />}
    </li>
  );
}
