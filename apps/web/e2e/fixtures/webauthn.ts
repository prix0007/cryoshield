/**
 * CDP virtual authenticators as physical "keys" (task 2.2). Every key is a separate CTAP2/USB authenticator with
 * resident keys, user verification (PIN) and PRF (hmac-secret). Only the key the test "touches" has user presence
 * enabled, so the browser can only complete a ceremony with that key.
 */
import type { CDPSession, Page } from '@playwright/test';

export class VirtualKeys {
  private ids: string[] = [];
  constructor(private cdp: CDPSession) {}

  /**
   * enforce-credprotect-uv fallback: Chrome's CDP virtual authenticator does not implement CTAP 2.1 credProtect
   * (no extension output, and enforceCredentialProtectionPolicy always fails with NotAllowedError; probed on the
   * pinned Playwright Chromium). So, by default, a test-only init script makes the virtual keys behave like
   * credProtect-capable keys:
   * - every create() request's extensions are recorded on window.__credProtectRequests (so tests assert the app asked
   *   for level 3 with enforcement);
   * - the request is forwarded without the credProtect fields;
   * - the returned authenticatorData gets the ED flag and the extension output {"credProtect": 3}, exactly as a
   *   CTAP 2.1 key reports it.
   * Pass { credProtect: false } to see the real browser behaviour (the app must refuse the key).
   * This never ships: it exists only in Playwright.
   */
  static async attach(page: Page, opts: { credProtect?: boolean } = {}): Promise<VirtualKeys> {
    const script = opts.credProtect ?? true ? CRED_PROTECT_SHIM : RECORD_ONLY;
    await page.addInitScript(script); // future navigations
    await page.evaluate(script); // and the page that is already open
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('WebAuthn.enable', { enableUI: false });
    return new VirtualKeys(cdp);
  }

  async add(opts: { prf?: boolean; uv?: boolean } = {}): Promise<number> {
    const { authenticatorId } = await this.cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'usb',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: opts.uv ?? true,
        hasPrf: opts.prf ?? true,
        automaticPresenceSimulation: false,
      },
    });
    this.ids.push(authenticatorId);
    return this.ids.length - 1;
  }

  /** "Insert and touch" key i: only key i answers ceremonies from now on. */
  async use(i: number) {
    for (let j = 0; j < this.ids.length; j++) {
      await this.cdp.send('WebAuthn.setAutomaticPresenceSimulation', { authenticatorId: this.ids[j]!, enabled: j === i });
    }
  }

  async credentials(i: number) {
    const { credentials } = await this.cdp.send('WebAuthn.getCredentials', { authenticatorId: this.ids[i]! });
    return credentials;
  }

  /** Total assertions (sign counts) across all credentials of key i. */
  async signCount(i: number) {
    return (await this.credentials(i)).reduce((n, c) => n + c.signCount, 0);
  }
}

const RECORD = `
  if (window.__credProtectShim) return;
  window.__credProtectShim = true;
  window.__credProtectRequests = [];
  const create = navigator.credentials.create.bind(navigator.credentials);
`;
const RECORD_ONLY = `(() => {${RECORD}
  navigator.credentials.create = (o) => {
    const x = (o && o.publicKey && o.publicKey.extensions) || {};
    window.__credProtectRequests.push({ policy: x.credentialProtectionPolicy, enforce: x.enforceCredentialProtectionPolicy });
    return create(o);
  };
})();`;
const CRED_PROTECT_SHIM = `(() => {${RECORD}
  navigator.credentials.create = async (o) => {
    const pk = o && o.publicKey;
    const x = (pk && pk.extensions) || {};
    window.__credProtectRequests.push({ policy: x.credentialProtectionPolicy, enforce: x.enforceCredentialProtectionPolicy });
    const { credentialProtectionPolicy, enforceCredentialProtectionPolicy, ...rest } = x;
    const cred = await create({ ...o, publicKey: { ...pk, extensions: rest } });
    if (credentialProtectionPolicy !== 'userVerificationRequired') return cred;
    const ad = new Uint8Array(cred.response.getAuthenticatorData());
    // CBOR {"credProtect": 3}: a1 6b "credProtect" 03
    const ext = new Uint8Array([0xa1, 0x6b, ...new TextEncoder().encode('credProtect'), 0x03]);
    const out = new Uint8Array(ad.length + ext.length);
    out.set(ad);
    out.set(ext, ad.length);
    out[32] |= 0x80;
    Object.defineProperty(cred.response, 'getAuthenticatorData', { value: () => out.slice().buffer });
    return cred;
  };
})();`;
