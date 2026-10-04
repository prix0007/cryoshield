/** add-supported-devices-page: key-error states point to /devices ("See supported devices"); other errors don't. */
import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Notice } from '../../src/ui/components';
import { S } from '../../src/ui/strings';
import { renderApp } from './helpers';

const link = (el: HTMLElement) => within(el).queryByRole('link', { name: 'See supported devices' });

describe('"See supported devices" on key errors', () => {
  it.each([
    ['CRED_PROTECT_UNSUPPORTED', S.keyErrors.CRED_PROTECT_UNSUPPORTED!],
    ['PRF_UNSUPPORTED_KEY', S.keyErrors.PRF_UNSUPPORTED_KEY!],
    ['WRONG_ALGORITHM', S.keyErrors.WRONG_ALGORITHM!],
    ['enrollment cancel (may be a key without credProtect)', S.enrollCancelled],
  ])('%s links /devices', (_name, msg) => {
    render(<Notice kind="error">{msg}</Notice>);
    expect(link(screen.getByRole('alert'))).toHaveAttribute('href', '/devices');
  });

  it.each([['network', S.unlock.networkError], ['PIN', S.keyErrors.USER_NOT_VERIFIED!], ['nothing saved', S.save.nothingSaved]])('%s errors do not', (_n, msg) => {
    render(<Notice kind="error">{msg}</Notice>);
    expect(link(screen.getByRole('alert'))).toBeNull();
  });

  it('the unsupported-browser notice links /devices', async () => {
    (globalThis as { PublicKeyCredential?: unknown }).PublicKeyCredential = { getClientCapabilities: async () => ({ 'extension:prf': false }) };
    try {
      renderApp();
      const alert = await screen.findByRole('alert');
      await waitFor(() => expect(alert).toHaveTextContent('Browser not supported'));
      expect(link(alert)).toHaveAttribute('href', '/devices');
    } finally {
      delete (globalThis as { PublicKeyCredential?: unknown }).PublicKeyCredential;
    }
  });

  it('the app footer links /devices', () => {
    renderApp();
    expect(within(screen.getByRole('contentinfo')).getByRole('link', { name: 'Supported devices' })).toHaveAttribute('href', '/devices');
  });
});
