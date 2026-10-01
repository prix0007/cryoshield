import { describe, expect, it } from 'vitest';
import { FakeAuthenticators } from './fake-webauthn';

describe('fake navigator.credentials (task 2.1)', () => {
  it('records each ceremony and returns stable PRF for the same credential and salt', async () => {
    const f = new FakeAuthenticators();
    f.addKey();
    const salt = new Uint8Array(32).fill(7);
    const c = await f.credentials.create({
      publicKey: { rp: { id: 'localhost', name: 'x' }, user: { id: new Uint8Array(16), name: 'u', displayName: 'u' }, challenge: new Uint8Array(32), pubKeyCredParams: [{ type: 'public-key', alg: -7 }], extensions: { prf: { eval: { first: salt } } } as any },
    });
    const g1 = await f.credentials.get({ publicKey: { rpId: 'localhost', challenge: new Uint8Array(32), extensions: { prf: { eval: { first: salt } } } as any } });
    const g2 = await f.credentials.get({ publicKey: { rpId: 'localhost', challenge: new Uint8Array(32), extensions: { prf: { eval: { first: salt } } } as any } });
    expect(f.calls.map((x) => x.kind)).toEqual(['create', 'get', 'get']);
    expect(new Uint8Array(g1.getClientExtensionResults().prf.results.first)).toEqual(new Uint8Array(g2.getClientExtensionResults().prf.results.first));
    expect(c.getClientExtensionResults().prf.enabled).toBe(true);
  });
});
