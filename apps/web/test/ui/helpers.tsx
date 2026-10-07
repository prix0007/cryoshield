import { render, screen } from '@testing-library/react';
import type userEvent from '@testing-library/user-event';
import { App } from '../../src/ui/App';
import type { Services } from '../../src/ui/services';

export function fakeServices(over: Partial<Services> = {}): Services {
  return {
    rpId: 'localhost',
    rpName: 'test',
    chainId: 31337,
    host: 'localhost',
    reader: {} as Services['reader'],
    client: {} as Services['client'],
    sponsor: { send: async () => ({ userOpHash: '0x', success: true }) },
    mirror: { upload: async () => 'id', ensure: async () => ({ state: 'present', id: 'A'.repeat(43) }), lookup: async () => [] } as unknown as Services['mirror'],
    fastIndexUrl: 'https://turbo-gateway.com',
    network: { name: 'local test chain', explorerUrl: null },
    registries: [{ version: 'v2', address: '0x00000000000000000000000000000000000000a2' }],
    arweaveGatewayUrl: 'https://arweave.net',
    ...over,
  };
}

export function renderApp(over: Partial<Services> = {}) {
  (globalThis as { PublicKeyCredential?: unknown }).PublicKeyCredential ??= {
    getClientCapabilities: async () => ({ 'extension:prf': true }),
  };
  return render(<App services={fakeServices(over)} />);
}

/** Ticks the create flow's permanence + 18+ acknowledgement (add-privacy-and-compliance 4.1). */
export async function acknowledge(u: ReturnType<typeof userEvent.setup>) {
  await u.click(screen.getByRole('checkbox', { name: /published permanently/ }));
  await u.click(screen.getByRole('checkbox', { name: 'I am 18 or over.' }));
}
