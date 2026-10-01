/** Tasks 2.2 / 2.4: the CDP virtual authenticator supports PRF, with stable output per credential+salt. */
import { expect, test } from '@playwright/test';
import { VirtualKeys } from '../fixtures/webauthn';

test('virtual authenticator returns stable PRF results with UV', async ({ page }) => {
  await page.goto('/');
  const keys = await VirtualKeys.attach(page);
  await keys.add();
  await keys.use(0);
  const r = await page.evaluate(async () => {
    const salt = new Uint8Array(32).fill(5);
    const cred = (await navigator.credentials.create({
      publicKey: {
        rp: { id: 'localhost', name: 'x' },
        user: { id: new Uint8Array(16), name: 'u', displayName: 'u' },
        challenge: new Uint8Array(32),
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential;
    const created = cred.getClientExtensionResults() as { prf?: { enabled?: boolean; results?: { first: ArrayBuffer } } };
    const get = async () => {
      const a = (await navigator.credentials.get({
        publicKey: { rpId: 'localhost', challenge: new Uint8Array(32), userVerification: 'required', extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs },
      })) as PublicKeyCredential;
      const ext = a.getClientExtensionResults() as { prf?: { results?: { first: ArrayBuffer } } };
      const flags = new Uint8Array((a.response as AuthenticatorAssertionResponse).authenticatorData)[32]!;
      return { prf: Array.from(new Uint8Array(ext.prf!.results!.first)), uv: (flags & 4) === 4 };
    };
    const g1 = await get();
    const g2 = await get();
    return { enabled: created.prf?.enabled, atCreate: !!created.prf?.results, g1, g2 };
  });
  expect(r.enabled).toBe(true);
  expect(r.g1.uv).toBe(true);
  expect(r.g1.prf).toHaveLength(32);
  expect(r.g1.prf).toEqual(r.g2.prf);
  console.log(`virtual authenticator: PRF at create = ${r.atCreate}`);
});
