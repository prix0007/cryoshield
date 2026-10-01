/**
 * CDP virtual authenticators as physical "keys" (task 2.2). Every key is a separate CTAP2/USB authenticator with
 * resident keys, user verification (PIN) and PRF (hmac-secret). Only the key the test "touches" has user presence
 * enabled, so the browser can only complete a ceremony with that key.
 */
import type { CDPSession, Page } from '@playwright/test';

export class VirtualKeys {
  private ids: string[] = [];
  constructor(private cdp: CDPSession) {}

  static async attach(page: Page): Promise<VirtualKeys> {
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
