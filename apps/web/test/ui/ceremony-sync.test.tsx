/**
 * app-motion-ux guardrail (a): animation never delays a WebAuthn ceremony. With every timer and animation frame
 * frozen, the ceremony call must already have happened once the click's microtasks settle.
 */
import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from './helpers';

const never = () => new Promise<never>(() => undefined);
const flushMicrotasks = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
/** Freezes every timer and animation frame (microtasks still run, as they do inside a real user gesture). */
const freeze = () => vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });

afterEach(() => vi.useRealTimers());

describe('ceremonies start in the gesture task (guardrail a)', () => {
  it('Set up key 1 -> credentials.create before any frame or timer runs', async () => {
    const credentials = { create: vi.fn(never), get: vi.fn(never) };
    const u = userEvent.setup();
    renderApp({ credentials });
    await u.click(screen.getByRole('button', { name: 'Create a new vault' }));
    await u.click(await screen.findByRole('button', { name: 'Get started' }));
    const btn = await screen.findByRole('button', { name: 'Set up key 1' });
    freeze();
    act(() => void fireEvent.click(btn));
    await flushMicrotasks();
    expect(credentials.create).toHaveBeenCalledTimes(1);
  });

  it('Unlock -> credentials.get before any frame or timer runs', async () => {
    const credentials = { create: vi.fn(never), get: vi.fn(never) };
    const u = userEvent.setup();
    renderApp({ credentials });
    await u.click(screen.getByRole('button', { name: 'Unlock my vault' }));
    const btn = await screen.findByRole('button', { name: 'Unlock with my key' });
    freeze();
    act(() => void fireEvent.click(btn));
    await flushMicrotasks();
    expect(credentials.get).toHaveBeenCalledTimes(1);
  });
});
