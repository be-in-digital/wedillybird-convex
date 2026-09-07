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

    for (const role of ['couple', 'pro', 'guest', 'admin']) {
      expect(screen.getByText(`Admin.roles.${role}`)).toBeInTheDocument();
    }
    // Aucune valeur brute ne doit rester visible dans un badge.
    expect(screen.queryByText('guest', { exact: true })).toBeNull();
    expect(screen.queryByText('admin', { exact: true })).toBeNull();
  });
});
