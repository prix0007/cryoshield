/** redesign-landing-and-app-ui 4.2: restyled screens keep behaviour and add validation/empty states. */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SecretsEditor } from '../../src/ui/components';
import * as ops from '../../src/ui/operations';
import { ServicesProvider } from '../../src/ui/services';
import { S } from '../../src/ui/strings';
import { VaultView } from '../../src/ui/VaultView';
import { fakeServices, renderApp } from './helpers';

const credIds = [new Uint8Array(48).fill(1), new Uint8Array(48).fill(2)];

describe('app shell', () => {
  it('has a skip link, the global nav, the sub-nav with Testnet, and main#main', () => {
    const { container } = renderApp();
    const skip = container.querySelector('a.skip-link');
    expect(skip).toHaveAttribute('href', '#main');
    expect(screen.getByRole('navigation', { name: 'Site' })).toBeInTheDocument();
    expect(screen.getByText('Testnet')).toBeInTheDocument();
    expect(container.querySelector('main#main')).not.toBeNull();
  });

  it('home actions sit in the floating action bar, in their original order', () => {
    renderApp();
    const unlock = screen.getByRole('button', { name: S.home.unlock });
    const bar = unlock.closest('.action-bar')!;
    expect([...bar.querySelectorAll('button')].map((b) => b.textContent)).toEqual([S.home.unlock, S.home.create]);
  });
});

describe('secrets editor validation', () => {
  it('marks the secret field invalid and described by the meter when over capacity; Save is disabled', () => {
    render(<SecretsEditor rpId="localhost" credIds={credIds} items={[{ label: 'x', secret: 'a'.repeat(3000) }]} onChange={() => {}} onSave={() => {}} />);
    const field = screen.getByLabelText(S.editor.secret);
    expect(field).toHaveAttribute('aria-invalid', 'true');
    const meter = screen.getByText(/Too much text/);
    expect(field.getAttribute('aria-describedby')).toContain(meter.id);
    expect(meter).toHaveClass('meter-over');
    expect(screen.getByRole('button', { name: S.editor.save })).toBeDisabled();
  });

  it('a fitting secret is not marked invalid', () => {
    render(<SecretsEditor rpId="localhost" credIds={credIds} items={[{ label: 'x', secret: 'abc' }]} onChange={() => {}} onSave={() => {}} />);
    expect(screen.getByLabelText(S.editor.secret)).not.toHaveAttribute('aria-invalid');
  });
});

describe('empty vault', () => {
  it('shows the empty state and keeps "Edit secrets" available', () => {
    vi.spyOn(ops, 'ensureMirror').mockResolvedValue('saved');
    const session = { vaultId: ('0x' + '12'.repeat(32)) as `0x${string}`, owner: ('0x' + '34'.repeat(20)) as `0x${string}`, version: 1, blob: new Uint8Array(4), items: [], credIds };
    render(
      <ServicesProvider value={fakeServices()}>
        <VaultView session={session} locator="0x" onChange={() => {}} onLock={() => {}} />
      </ServicesProvider>,
    );
    expect(screen.getByText(S.vault.empty)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: S.vault.edit })).toBeEnabled();
  });
});

describe('disabled actions', () => {
  it('are native disabled buttons (exposed as disabled, out of the tab order), never aria-disabled-only', () => {
    renderApp({ host: 'ipfs.io', rpId: 'cryoshield.app' });
    for (const name of [S.home.unlock, S.home.create]) {
      const b = screen.getByRole('button', { name });
      expect(b).toBeDisabled();
      expect(b).toHaveProperty('disabled', true);
      expect(b).not.toHaveAttribute('aria-disabled', 'false');
    }
  });
});
