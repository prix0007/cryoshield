/**
 * footer-release-version (spec vault-web-app "Release version in the app footer"): the app footer shows the Version
 * line the release service resolves to, and nothing when it resolves to null or fails.
 */
import { act, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../../src/ui/App';
import { fakeServices, renderApp } from './helpers';

const REPO = 'https://github.com/prix0007/cryoshield';

describe('app footer release line', () => {
  it('shows "Version v1.0.3" linking to the GitHub release', async () => {
    renderApp({ release: async () => ({ text: 'v1.0.3', href: `${REPO}/releases/tag/v1.0.3` }) });
    const footer = screen.getByRole('contentinfo');
    const link = await within(footer).findByRole('link', { name: 'v1.0.3' });
    expect(link).toHaveAttribute('href', `${REPO}/releases/tag/v1.0.3`);
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link.closest('.release')?.textContent).toBe('Version v1.0.3');
  });

  it('shows the development label the service resolves to', async () => {
    renderApp({ release: async () => ({ text: 'dev abcdef0', href: `${REPO}/commit/${'abcdef0'.padEnd(40, '0')}` }) });
    const footer = screen.getByRole('contentinfo');
    expect(await within(footer).findByRole('link', { name: 'dev abcdef0' })).toBeInTheDocument();
  });

  it.each<[string, () => Promise<null>]>([
    ['the service resolves null', async () => null],
    ['the service fails', async () => { throw new Error('offline'); }],
  ])('shows no line when %s', async (_n, release) => {
    renderApp({ release });
    await act(async () => undefined);
    expect(within(screen.getByRole('contentinfo')).queryByText(/Version/)).toBeNull();
  });

  it('asks the service once, not on every render (D5: the services container is stable)', async () => {
    const release = vi.fn(async () => ({ text: 'v1.0.3', href: `${REPO}/releases/tag/v1.0.3` }));
    const svc = fakeServices({ release });
    const { rerender } = render(<App services={svc} />);
    await within(screen.getByRole('contentinfo')).findByRole('link', { name: 'v1.0.3' });
    rerender(<App services={svc} />);
    await act(async () => undefined);
    expect(release).toHaveBeenCalledTimes(1);
  });
});
