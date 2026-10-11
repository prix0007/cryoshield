/**
 * reload-on-new-build D5: a non-blocking "new version" notice when the build check reports an update, at start and when
 * the tab becomes visible again (at most once per 60 s, never on a timer).
 */
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as buildCheck from '../../src/lib/build-check';
import type { BuildState } from '../../src/lib/build-check';
import { S } from '../../src/ui/strings';
import { renderApp } from './helpers';

function setVisibility(v: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
  document.dispatchEvent(new Event('visibilitychange'));
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  setVisibility('visible');
});

describe('update available notice', () => {
  it('checks once at start and shows a status notice with Reload page when outdated', async () => {
    const reload = vi.spyOn(buildCheck, 'reloadPage').mockImplementation(() => undefined);
    const check = vi.fn(async (): Promise<BuildState> => 'outdated');
    renderApp({ buildCheck: check });
    const note = await screen.findByText(S.updateAvailable);
    expect(note.closest('[role="status"]')).not.toBeNull();
    expect(check).toHaveBeenCalledTimes(1);
    await userEvent.setup().click(screen.getByRole('button', { name: S.reloadPage }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it.each<BuildState>(['current', 'unknown'])('%s: no notice', async (state) => {
    const check = vi.fn(async (): Promise<BuildState> => state);
    renderApp({ buildCheck: check });
    await act(async () => undefined);
    expect(check).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(S.updateAvailable)).toBeNull();
  });

  it('re-checks when the tab becomes visible, throttled to once per 60 s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let state: BuildState = 'current';
    const check = vi.fn(async () => state);
    renderApp({ buildCheck: check });
    await act(async () => undefined);
    expect(check).toHaveBeenCalledTimes(1);

    state = 'outdated';
    await act(async () => setVisibility('hidden'));
    await act(async () => setVisibility('visible'));
    expect(check).toHaveBeenCalledTimes(1); // within 60 s of the last check
    expect(screen.queryByText(S.updateAvailable)).toBeNull();

    await act(async () => vi.advanceTimersByTime(60_000));
    expect(check).toHaveBeenCalledTimes(1); // no timer-driven polling
    await act(async () => setVisibility('hidden'));
    await act(async () => setVisibility('visible'));
    expect(check).toHaveBeenCalledTimes(2);
    expect(await screen.findByText(S.updateAvailable)).toBeInTheDocument();
  });
});
