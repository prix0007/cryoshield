/**
 * footer-release-version (spec vault-web-app "Release version in the app footer"): the app footer shows the Version
 * line the release service resolves to, and nothing when it resolves to null or fails.
 */
import { act, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from './helpers';

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

  it('shows no line when the release is unknown or the service fails', async () => {
    for (const release of [async () => null, async () => { throw new Error('offline'); }]) {
      const { unmount } = renderApp({ release });
      await act(async () => undefined);
      expect(within(screen.getByRole('contentinfo')).queryByText(/Version/)).toBeNull();
      unmount();
    }
  });
});
