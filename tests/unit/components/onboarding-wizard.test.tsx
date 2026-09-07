import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const pushMock = vi.fn();
const refreshMock = vi.fn();
const completeOnboardingActionMock = vi.fn();

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

vi.mock('@/app/[locale]/(auth)/actions', () => ({
  completeOnboardingAction: (formData: FormData) => completeOnboardingActionMock(formData),
}));

vi.mock('next-intl', () => ({
  useTranslations: (namespace?: string) => (key: string, vars?: Record<string, string>) => {
    if (vars && Object.keys(vars).length > 0) {
      return `${namespace ?? 'T'}.${key}:${JSON.stringify(vars)}`;
    }
    return `${namespace ?? 'T'}.${key}`;
  },
  useLocale: () => 'fr',
}));

// Mock Motion : passe les enfants directement, pas d'animations en jsdom.
// useReducedMotion = true → désactive les transforms (ce qui ferait que
// AnimatePresence garde les deux steps simultanément).
vi.mock('motion/react', async () => {
  const actual = await vi.importActual<typeof import('motion/react')>('motion/react');
  return {
    ...actual,
    useReducedMotion: () => true,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  };
});

import { OnboardingWizard } from '@/components/onboarding/onboarding-wizard';

beforeEach(() => {
  pushMock.mockReset();
  refreshMock.mockReset();
  completeOnboardingActionMock.mockReset();
});

describe('OnboardingWizard', () => {
  it('renders step 1 first (profile)', () => {
    render(<OnboardingWizard />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('stepProfile');
    expect(screen.getByLabelText('Onboarding.fullNameLabel')).toBeInTheDocument();
  });

  it('disables Next until both fullName (2+ chars) and a valid email are set', async () => {
    const user = userEvent.setup();
    render(<OnboardingWizard initialPhone="+33612345678" />);
    const next = screen.getByRole('button', { name: 'Onboarding.next' });
    expect(next).toBeDisabled();

    await user.type(screen.getByLabelText('Onboarding.fullNameLabel'), 'Al');
    expect(next).toBeDisabled();

    await user.type(screen.getByLabelText('Onboarding.emailLabel'), 'al@example.com');
    expect(next).toBeEnabled();
  });

  it('advances to role step (2 steps) when initialPhone is provided', async () => {
    const user = userEvent.setup();
    render(<OnboardingWizard initialPhone="+33612345678" />);
    await user.type(screen.getByLabelText('Onboarding.fullNameLabel'), 'Alice Martin');
    await user.type(screen.getByLabelText('Onboarding.emailLabel'), 'alice@example.com');
    await user.click(screen.getByRole('button', { name: 'Onboarding.next' }));

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('stepRole');
    const group = screen.getByRole('radiogroup');
    expect(within(group).getAllByRole('radio')).toHaveLength(2);
  });

  it('rejects invalid email format at step 1', async () => {
    const user = userEvent.setup();
    render(<OnboardingWizard initialPhone="+33612345678" />);
    await user.type(screen.getByLabelText('Onboarding.fullNameLabel'), 'Alice Martin');
    await user.type(screen.getByLabelText('Onboarding.emailLabel'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Onboarding.next' }));

    // Still on step 1 because email is invalid
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('stepProfile');
  });

  it('pre-fills email and locks the field when initialEmail is provided', () => {
    render(<OnboardingWizard initialEmail="alice@example.com" initialPhone="+33612345678" />);
    const emailInput = screen.getByLabelText('Onboarding.emailLabel') as HTMLInputElement;
    expect(emailInput.value).toBe('alice@example.com');
    expect(emailInput).toHaveAttribute('readonly');
  });

  it('submits with fullName, email and selected role (no secure step needed)', async () => {
    completeOnboardingActionMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<OnboardingWizard initialPhone="+33612345678" />);

    await user.type(screen.getByLabelText('Onboarding.fullNameLabel'), 'Alice Martin');
    await user.type(screen.getByLabelText('Onboarding.emailLabel'), 'alice@example.com');
    await user.click(screen.getByRole('button', { name: 'Onboarding.next' }));

    const group = screen.getByRole('radiogroup');
    await user.click(within(group).getAllByRole('radio')[0]!);
    await user.click(screen.getByRole('button', { name: 'Onboarding.finish' }));

    expect(completeOnboardingActionMock).toHaveBeenCalledTimes(1);
    const formData = completeOnboardingActionMock.mock.calls[0]![0] as FormData;
    expect(formData.get('fullName')).toBe('Alice Martin');
    expect(formData.get('role')).toBe('couple');
    expect(formData.get('email')).toBe('alice@example.com');
  });

  describe('rôle déjà établi (admin, partenaire pro)', () => {
    // Un admin promu par ADMIN_PHONE, ou un partenaire ayant consommé son lien
    // d'invitation, arrive ici sans `fullName` mais avec un rôle. Lui demander
    // couple/pro le rétrograderait.
    it('masque le step rôle et envoie directement depuis le step profil', async () => {
      completeOnboardingActionMock.mockResolvedValue({ ok: true });
      const user = userEvent.setup();
      render(<OnboardingWizard initialPhone="+33612345678" initialRole="admin" />);

      // Un seul step → le CTA du profil est « Terminer », pas « Suivant ».
      expect(screen.queryByRole('button', { name: 'Onboarding.next' })).toBeNull();

      await user.type(screen.getByLabelText('Onboarding.fullNameLabel'), 'Alice Martin');
      await user.type(screen.getByLabelText('Onboarding.emailLabel'), 'alice@example.com');
      await user.click(screen.getByRole('button', { name: 'Onboarding.finish' }));

      expect(screen.queryByRole('radiogroup')).toBeNull();
      expect(completeOnboardingActionMock).toHaveBeenCalledTimes(1);
      const formData = completeOnboardingActionMock.mock.calls[0]![0] as FormData;
      expect(formData.get('fullName')).toBe('Alice Martin');
      expect(formData.get('email')).toBe('alice@example.com');
      // Rôle omis → le serveur conserve celui déjà en base.
      expect(formData.get('role')).toBeNull();
    });

    it('masque aussi le step rôle pour un partenaire déjà pro', async () => {
      const user = userEvent.setup();
      render(<OnboardingWizard initialPhone="+33612345678" initialRole="pro" />);

      await user.type(screen.getByLabelText('Onboarding.fullNameLabel'), 'Sarah Coach');
      await user.type(screen.getByLabelText('Onboarding.emailLabel'), 'sarah@example.com');

      expect(screen.queryByRole('button', { name: 'Onboarding.next' })).toBeNull();
      expect(screen.queryByRole('radiogroup')).toBeNull();
    });

    it('garde le step rôle pour un compte guest ou sans rôle', async () => {
      const user = userEvent.setup();
      render(<OnboardingWizard initialPhone="+33612345678" initialRole="guest" />);

      await user.type(screen.getByLabelText('Onboarding.fullNameLabel'), 'Alice Martin');
      await user.type(screen.getByLabelText('Onboarding.emailLabel'), 'alice@example.com');
      await user.click(screen.getByRole('button', { name: 'Onboarding.next' }));

      expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    });

    it("affiche l'erreur de soumission même sans step rôle", async () => {
      completeOnboardingActionMock.mockResolvedValue({ ok: false, error: 'BOOM' });
      const user = userEvent.setup();
      render(<OnboardingWizard initialPhone="+33612345678" initialRole="admin" />);

      await user.type(screen.getByLabelText('Onboarding.fullNameLabel'), 'Alice Martin');
      await user.type(screen.getByLabelText('Onboarding.emailLabel'), 'alice@example.com');
      await user.click(screen.getByRole('button', { name: 'Onboarding.finish' }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('Onboarding.errors.submit');
      });
    });
  });

  describe('secure step (phone link)', () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      fetchSpy = vi.spyOn(global, 'fetch');
    });

    afterEach(() => {
      fetchSpy.mockRestore();
    });

    it('inserts secure step when initialEmail is provided and initialPhone is empty', async () => {
      const user = userEvent.setup();
      render(<OnboardingWizard initialEmail="alice@example.com" />);
      await user.type(screen.getByLabelText('Onboarding.fullNameLabel'), 'Alice Martin');
      await user.click(screen.getByRole('button', { name: 'Onboarding.next' }));

      // Maintenant on est au step secure, pas role
      expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('stepSecure');
      expect(screen.getByLabelText('Onboarding.phoneLabel')).toBeInTheDocument();
      expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    });

    it('skips secure step when initialPhone is provided', async () => {
      const user = userEvent.setup();
      render(<OnboardingWizard initialPhone="+33612345678" />);
      await user.type(screen.getByLabelText('Onboarding.fullNameLabel'), 'Alice Martin');
      await user.type(screen.getByLabelText('Onboarding.emailLabel'), 'alice@example.com');
      await user.click(screen.getByRole('button', { name: 'Onboarding.next' }));

      expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('stepRole');
      expect(screen.queryByLabelText('Onboarding.phoneLabel')).not.toBeInTheDocument();
    });

    it('inserts secure step when both initialEmail and initialPhone are empty', async () => {
      const user = userEvent.setup();
      render(<OnboardingWizard />);
      await user.type(screen.getByLabelText('Onboarding.fullNameLabel'), 'Alice Martin');
      await user.type(screen.getByLabelText('Onboarding.emailLabel'), 'alice@example.com');
      await user.click(screen.getByRole('button', { name: 'Onboarding.next' }));

      expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('stepSecure');
    });

    it('calls /api/account/link/phone/request when sending code', async () => {
      fetchSpy.mockResolvedValue(
        new Response(JSON.stringify({ ok: true, phone: '+33612345678' }), { status: 200 }),
      );
      const user = userEvent.setup();
      render(<OnboardingWizard initialEmail="alice@example.com" />);

      await user.type(screen.getByLabelText('Onboarding.fullNameLabel'), 'Alice Martin');
      await user.click(screen.getByRole('button', { name: 'Onboarding.next' }));

      await user.type(screen.getByLabelText('Onboarding.phoneLabel'), '+33612345678');
      await user.click(screen.getByRole('button', { name: 'Onboarding.sendCode' }));

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          '/api/account/link/phone/request',
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ phone: '+33612345678' }),
          }),
        );
      });
    });

    it('shows PHONE_TAKEN copy when API returns that error', async () => {
      fetchSpy.mockResolvedValue(
        new Response(JSON.stringify({ ok: false, error: 'PHONE_TAKEN' }), { status: 400 }),
      );
      const user = userEvent.setup();
      render(<OnboardingWizard initialEmail="alice@example.com" />);

      await user.type(screen.getByLabelText('Onboarding.fullNameLabel'), 'Alice Martin');
      await user.click(screen.getByRole('button', { name: 'Onboarding.next' }));

      await user.type(screen.getByLabelText('Onboarding.phoneLabel'), '+33612345678');
      await user.click(screen.getByRole('button', { name: 'Onboarding.sendCode' }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('Onboarding.errors.phoneTaken');
      });
    });
  });
});
