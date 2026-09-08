'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * Select de filtrage de la barre d'outils. Le `Select` générique fait 44 px de
 * haut (cible tactile d'un formulaire) ; dans une barre d'outils il déséquilibre
 * la ligne face au champ de recherche de 40 px. On aligne ici sur 40 px, et le
 * libellé du filtre est intégré au déclencheur pour qu'un « Tous » isolé ne
 * laisse pas deviner de quoi il parle.
 */
export function AdminFilterSelect({
  label,
  value,
  onValueChange,
  children,
  className,
  widthClassName = 'w-full sm:w-auto sm:min-w-[10rem]',
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
  className?: string;
  widthClassName?: string;
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger
        aria-label={label}
        className={cn(
          'h-10 gap-2 rounded-lg border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-sm',
          widthClassName,
          className,
        )}
      >
        <span className="text-[color:var(--color-muted-foreground)]">{label}</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>{children}</SelectContent>
    </Select>
  );
}

export { SelectItem as AdminFilterOption };
