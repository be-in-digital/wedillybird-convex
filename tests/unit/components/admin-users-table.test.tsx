import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next-intl', () => ({
  // On rend la clé pour vérifier qu'une clé est bien demandée — le bug était
  // que le badge affichait la valeur brute en base (`guest`, `admin`).
  useTranslations: (namespace?: string) => (key: string, vars?: Record<string, string>) =>
    vars && Object.keys(vars).length > 0
      ? `${namespace ?? 'T'}.${key}:${JSON.stringify(vars)}`
      : `${namespace ?? 'T'}.${key}`,
  useLocale: () => 'fr',
}));

vi.mock('@/lib/hooks/use-server-action', () => ({
  useServerAction: () => ({ execute: vi.fn(), loading: false }),
}));

vi.mock('@/components/ui/confirm-dialog', () => ({
  useConfirm: () => ({ confirm: vi.fn(), confirmDialog: null }),
}));

vi.mock('@/app/[locale]/(app)/admin/actions', () => ({
  adminSuspendUserAction: vi.fn(),
  adminUnsuspendUserAction: vi.fn(),
  adminChangeUserRoleAction: vi.fn(),
  adminSetAffiliateOwnerAction: vi.fn(),
}));

import { AdminUsersTable } from '@/components/admin/admin-users-table';

const base = { createdAt: 0 };

describe('AdminUsersTable — libellé de rôle', () => {
  it("traduit chaque rôle au lieu d'afficher la valeur en base", () => {
    render(
      <AdminUsersTable
        users={[
          { ...base, _id: 'u1', fullName: 'Alice', role: 'couple' },
          { ...base, _id: 'u2', fullName: 'Sarah', role: 'pro' },
          { ...base, _id: 'u3', fullName: 'Bob', role: 'guest' },
          { ...base, _id: 'u4', fullName: 'Root', role: 'admin' },
        ]}
      />,
    );

    // L'admin n'est plus dans la vue par défaut : son libellé est couvert par
    // `matchesRoleFilter` et par le test dédié de la règle.
    for (const role of ['couple', 'pro', 'guest']) {
      expect(screen.getByText(`Admin.roles.${role}`)).toBeInTheDocument();
    }
    // Aucune valeur brute ne doit rester visible dans un badge.
    expect(screen.queryByText('guest', { exact: true })).toBeNull();
  });
});

describe('comptes admin hors de la vue par défaut', () => {
  it("n'affiche pas les comptes d'administration au chargement", () => {
    // Ce tableau sert à regarder des clients : s'y voir soi-même n'apprend
    // rien. La porte de retour (filtre « Admin ») est couverte par le test de
    // `matchesRoleFilter` — piloter le Select Radix en jsdom n'apporterait que
    // de la fragilité.
    render(
      <AdminUsersTable
        users={[
          { ...base, _id: 'u1', fullName: 'Alice', role: 'couple' },
          { ...base, _id: 'u4', fullName: 'Root', role: 'admin' },
        ]}
      />,
    );
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.queryByText('Root')).toBeNull();
  });
});
