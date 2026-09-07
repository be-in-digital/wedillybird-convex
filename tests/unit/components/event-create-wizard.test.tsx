import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const createEventActionMock = vi.fn();

vi.mock('@/app/[locale]/(app)/events/actions', () => ({
  createEventAction: (formData: FormData) => createEventActionMock(formData),
}));

vi.mock('next-intl', () => ({
  useTranslations: (namespace?: string) => (key: string, vars?: Record<string, unknown>) => {
    const base = `${namespace ?? 'T'}.${key}`;
    if (!vars) return base;
    return `${base}(${Object.entries(vars)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(',')})`;
  },
}));

import { EventCreateWizard } from '@/components/events/event-create-wizard';

beforeEach(() => {
  createEventActionMock.mockReset();
});

function futureLocalDatetime(offsetMs: number): string {
  const d = new Date(Date.now() + offsetMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function fillStepsUpToPlan(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('EventCreate.titleLabel'), 'Mariage F & A');
  await user.type(screen.getByLabelText('EventCreate.partnerALabel'), 'Fatou');
  await user.type(screen.getByLabelText('EventCreate.partnerBLabel'), 'Amadou');
  await user.click(screen.getByRole('button', { name: 'EventCreate.next' }));

  const dateInput = screen.getByLabelText('EventCreate.dateLabel') as HTMLInputElement;
  const future = futureLocalDatetime(3 * 24 * 60 * 60 * 1000);
  fireEvent.change(dateInput, { target: { value: future } });
  await user.click(screen.getByRole('button', { name: 'EventCreate.next' }));

  // Step 2 — venue (optional, skip)
  await user.click(screen.getByRole('button', { name: 'EventCreate.next' }));

  // Step 3 — theme (optional, defaults already set, skip)
  await user.click(screen.getByRole('button', { name: 'EventCreate.next' }));
}

describe('EventCreateWizard — couple', () => {
  it('starts on step 1 (couple info)', () => {
    render(<EventCreateWizard hasOrganization={false} />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('stepCouple');
  });

  it('disables Next until title and partners are filled', async () => {
    const user = userEvent.setup();
    render(<EventCreateWizard hasOrganization={false} />);
    const next = screen.getByRole('button', { name: 'EventCreate.next' });
    expect(next).toBeDisabled();

    await user.type(screen.getByLabelText('EventCreate.titleLabel'), 'Mariage F & A');
    await user.type(screen.getByLabelText('EventCreate.partnerALabel'), 'Fatou');
    await user.type(screen.getByLabelText('EventCreate.partnerBLabel'), 'Amadou');
    expect(next).toBeEnabled();
  });

  it('disables submit on the plan step until a forfait is selected', async () => {
    const user = userEvent.setup();
    render(<EventCreateWizard hasOrganization={false} />);

    await fillStepsUpToPlan(user);

    // Now on plan step — header visible, submit button disabled until choice.
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('stepPlan');
    const submit = screen.getByRole('button', { name: 'EventCreate.submit' });
    expect(submit).toBeDisabled();

    await user.click(screen.getByTestId('plan-option-essential'));
    expect(submit).toBeEnabled();
  });

  it('submits with the selected pendingPlanTier', async () => {
    createEventActionMock.mockResolvedValue({ ok: true, slug: 'fatou-amadou' });
    const user = userEvent.setup();
    render(<EventCreateWizard hasOrganization={false} />);

    await fillStepsUpToPlan(user);

    await user.click(screen.getByTestId('plan-option-premium'));
    await user.click(screen.getByRole('button', { name: 'EventCreate.submit' }));

    expect(createEventActionMock).toHaveBeenCalledTimes(1);
    const fd = createEventActionMock.mock.calls[0]![0] as FormData;
    expect(fd.get('title')).toBe('Mariage F & A');
    expect(fd.get('partnerA')).toBe('Fatou');
    expect(fd.get('partnerB')).toBe('Amadou');
    expect(fd.get('pendingPlanTier')).toBe('premium');
  });

  it('surfaces server-side field errors and jumps back to step 1', async () => {
    createEventActionMock.mockResolvedValue({
      ok: false,
      error: 'INVALID_INPUT',
      fieldErrors: { title: ['Titre trop court'] },
    });
    const user = userEvent.setup();
    render(<EventCreateWizard hasOrganization={false} />);

    await fillStepsUpToPlan(user);
    await user.click(screen.getByTestId('plan-option-essential'));
    await user.click(screen.getByRole('button', { name: 'EventCreate.submit' }));

    expect(await screen.findByText('Titre trop court')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('stepCouple');
  });
});

describe('EventCreateWizard — pro', () => {
  it('skips the plan step (pro billing handled separately)', async () => {
    createEventActionMock.mockResolvedValue({ ok: true, slug: 'pro-event' });
    const user = userEvent.setup();
    render(<EventCreateWizard hasOrganization />);

    await user.type(screen.getByLabelText('EventCreate.titleLabel'), 'Mariage Pro');
    await user.type(screen.getByLabelText('EventCreate.partnerALabel'), 'A');
    await user.type(screen.getByLabelText('EventCreate.partnerBLabel'), 'B');
    await user.click(screen.getByRole('button', { name: 'EventCreate.next' }));

    const dateInput = screen.getByLabelText('EventCreate.dateLabel') as HTMLInputElement;
    fireEvent.change(dateInput, {
      target: { value: futureLocalDatetime(3 * 24 * 60 * 60 * 1000) },
    });
    await user.click(screen.getByRole('button', { name: 'EventCreate.next' }));

    // venue (skip)
    await user.click(screen.getByRole('button', { name: 'EventCreate.next' }));

    // theme is the LAST step for pro — submit button should appear.
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('stepTheme');
    await user.click(screen.getByRole('button', { name: 'EventCreate.submit' }));

    expect(createEventActionMock).toHaveBeenCalledTimes(1);
    const fd = createEventActionMock.mock.calls[0]![0] as FormData;
    expect(fd.get('pendingPlanTier')).toBeNull();
  });
});
