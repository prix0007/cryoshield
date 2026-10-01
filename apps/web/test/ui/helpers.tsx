import { render } from '@testing-library/react';
import { App } from '../../src/ui/App';
import type { Services } from '../../src/ui/services';

export function fakeServices(over: Partial<Services> = {}): Services {
  return {
    rpId: 'localhost',
    rpName: 'test',
    host: 'localhost',
    reader: {} as Services['reader'],
    client: {} as Services['client'],
    sponsor: { send: async () => ({ userOpHash: '0x', success: true }) },
    mirror: { upload: async () => 'id', ensure: async () => 'present', lookup: async () => [] } as unknown as Services['mirror'],
    ...over,
  };
}

export function renderApp(over: Partial<Services> = {}) {
  (globalThis as { PublicKeyCredential?: unknown }).PublicKeyCredential ??= {
    getClientCapabilities: async () => ({ 'extension:prf': true }),
  };
  return render(<App services={fakeServices(over)} />);
}
