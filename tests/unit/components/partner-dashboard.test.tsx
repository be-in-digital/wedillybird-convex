import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) => {
    if (vars) {
      const parts = Object.entries(vars).map(([k, v]) => `${k}=${String(v)}`);
      return `${key}(${parts.join(',')})`;
    }
    return key;
  },
  useFormatter: () => ({
    number: (value: number, opts?: { currency?: string }) =>
      `${value.toFixed(2)} ${opts?.currency ?? ''}`.trim(),
    dateTime: (value: Date) => value.toISOString().slice(0, 10),
  }),
}));

import { PartnerDashboard } from '@/components/partner/partner-dashboard';

const CODE = {
  code: 'SARAH',
  rateBps: 2000,
  buyerDiscountBps: 0,
  status: 'active' as const,
  displayName: 'Sarah',
  shareable: false,
};

const REFERRAL = {
  id: 'r1',
  code: 'SARAH',
  status: 'vested' as const,
  rewardMinor: 1180,
  netMinor: 5900,
  currency: 'EUR',
  vestsAt: Date.UTC(2026, 5, 20),
  createdAt: Date.UTC(2026, 0, 12),
};

// jsdom expose `navigator.clipboard` en getter seul → on redéfinit la propriété
// plutôt que de l'assigner.
const writeText = vi.fn().mockResolvedValue(undefined);
Object.defineProperty(navigator, 'clipboard', {
  configurable: true,
  value: { writeText },
});

beforeEach(() => {
  writeText.mockClear();
});

describe('PartnerDashboard', () => {
  it('affiche le lien d’attribution, pas seulement le code', () => {
    // C'est le clic sur `?ref=` qui pose le cookie d'attribution : un partenaire
    // qui ne partagerait que « SARAH » perdrait la commission des acheteurs qui
    // ne saisissent pas le code au checkout.
    render(<PartnerDashboard codes={[CODE]} referrals={[]} totals={[]} salesCount={0} />);
    const input = screen.getByDisplayValue(/\?ref=SARAH$/);
    expect(input).toBeTruthy();
  });

  it('copie le lien complet dans le presse-papier', async () => {
    // `fireEvent` plutôt que `userEvent` : `userEvent.setup()` remplace
    // `navigator.clipboard` par son propre stub et masquerait le nôtre.
    render(<PartnerDashboard codes={[CODE]} referrals={[]} totals={[]} salesCount={0} />);
    fireEvent.click(screen.getAllByRole('button', { name: /copy/i })[0]!);
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('?ref=SARAH')),
    );
  });

  it('annonce la commission seule quand il n’y a pas de remise filleul', () => {
    render(<PartnerDashboard codes={[CODE]} referrals={[]} totals={[]} salesCount={0} />);
    expect(screen.getByText('codeTerms(rate=20)')).toBeTruthy();
  });

  it('annonce commission ET remise quand le code remise l’audience', () => {
    render(
      <PartnerDashboard
        codes={[{ ...CODE, buyerDiscountBps: 1000 }]}
        referrals={[]}
        totals={[]}
        salesCount={0}
      />,
    );
    expect(screen.getByText('codeTermsWithDiscount(rate=20,discount=10)')).toBeTruthy();
  });

  it('sépare l’acquis (payable) de l’en-attente (mariage pas encore passé)', () => {
    render(
      <PartnerDashboard
        codes={[CODE]}
        referrals={[REFERRAL]}
        totals={[
          { currency: 'EUR', status: 'vested', minor: 1180 },
          { currency: 'EUR', status: 'pending', minor: 2360 },
        ]}
        salesCount={3}
      />,
    );
    // 11,80 € apparaît deux fois : dans la tuile « acquis » et dans le détail.
    expect(screen.getAllByText('11.80 EUR').length).toBeGreaterThan(0);
    expect(screen.getByText('23.60 EUR')).toBeTruthy();
    expect(screen.getByText('statVestedHint')).toBeTruthy();
    expect(screen.getByText('statPendingHint')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('exclut les commissions annulées des totaux affichés', () => {
    // `reversed` est filtré côté serveur ; l'UI ne doit pas non plus l'inventer.
    render(
      <PartnerDashboard
        codes={[CODE]}
        referrals={[]}
        totals={[{ currency: 'EUR', status: 'reversed', minor: 5000 }]}
        salesCount={0}
      />,
    );
    expect(screen.queryByText('50.00 EUR')).toBeNull();
  });

  it('état vide explicite quand aucune vente n’est attribuée', () => {
    render(<PartnerDashboard codes={[CODE]} referrals={[]} totals={[]} salesCount={0} />);
    expect(screen.getByText('ledgerEmpty')).toBeTruthy();
  });

  it('signale un code désactivé', () => {
    render(
      <PartnerDashboard
        codes={[{ ...CODE, status: 'disabled' }]}
        referrals={[]}
        totals={[]}
        salesCount={0}
      />,
    );
    expect(screen.getByText('codeDisabled')).toBeTruthy();
  });

  it('n’affiche PAS de code à taper tant qu’aucun code promo Stripe n’existe', () => {
    // Inviter à partager un code que le checkout refuserait ferait passer la
    // partenaire pour une menteuse auprès de son audience.
    render(
      <PartnerDashboard
        codes={[{ ...CODE, buyerDiscountBps: 1000, shareable: false }]}
        referrals={[]}
        totals={[]}
        salesCount={0}
      />,
    );
    expect(screen.queryByText('codeLabel')).toBeNull();
    expect(screen.getByText('linkLabel')).toBeTruthy();
  });

  it('affiche le code à taper quand il est réellement accepté au checkout', () => {
    render(
      <PartnerDashboard
        codes={[{ ...CODE, buyerDiscountBps: 1000, shareable: true }]}
        referrals={[]}
        totals={[]}
        salesCount={0}
      />,
    );
    expect(screen.getByText('codeLabel')).toBeTruthy();
    expect(screen.getByDisplayValue('SARAH')).toBeTruthy();
  });

  it('copie le code seul (pas le lien) depuis le champ code', async () => {
    render(
      <PartnerDashboard
        codes={[{ ...CODE, buyerDiscountBps: 1000, shareable: true }]}
        referrals={[]}
        totals={[]}
        salesCount={0}
      />,
    );
    // Deux champs : lien puis code. Le second copie la chaîne nue.
    const buttons = screen.getAllByRole('button', { name: /copy/i });
    fireEvent.click(buttons[1]!);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('SARAH'));
  });
});
