/**
 * Software stand-in for navigator.credentials in unit tests (task 2.1).
 * - real P-256 keys (WebCrypto) so signatures verify;
 * - PRF = HMAC-SHA256(credential secret, salt) (separate secrets with and without UV, like CTAP2 hmac-secret);
 * - records every ceremony's options for assertions;
 * - programmable: PRF support, UV flag, PRF-at-create, user cancel.
 */

const enc = new TextEncoder();

export interface FakeKeyOptions {
  prf?: boolean; // authenticator supports hmac-secret / PRF
  prfAtCreate?: boolean; // returns PRF results during create (YubiKey 5.8+)
  uv?: boolean; // sets the UV flag
}

interface Cred {
  id: Uint8Array;
  rpId: string;
  keyPair: CryptoKeyPair;
  secretUv: Uint8Array;
  secretNoUv: Uint8Array;
  userId: Uint8Array;
}

export interface FakeKey {
  opts: Required<FakeKeyOptions>;
  creds: Cred[];
}

function rand(n: number) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

async function sha256(b: Uint8Array) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(b)));
}

async function hmac(key: Uint8Array, msg: Uint8Array) {
  const k = await crypto.subtle.importKey('raw', new Uint8Array(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, new Uint8Array(msg)));
}

function concat(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function u8(x: BufferSource | undefined): Uint8Array {
  if (!x) return new Uint8Array();
  if (x instanceof ArrayBuffer) return new Uint8Array(x);
  return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
}

function b64url(b: Uint8Array) {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Raw (r||s) -> DER, as authenticators return. */
function derSig(raw: Uint8Array) {
  const int = (b: Uint8Array) => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    let v = b.slice(i);
    if (v[0]! & 0x80) v = concat(Uint8Array.of(0), v);
    return concat(Uint8Array.of(0x02, v.length), v);
  };
  const body = concat(int(raw.slice(0, 32)), int(raw.slice(32)));
  return concat(Uint8Array.of(0x30, body.length), body);
}

export class DOMExceptionLike extends Error {
  constructor(message: string, override name: string) {
    super(message);
  }
}

export class FakeAuthenticators {
  keys: FakeKey[] = [];
  active = 0;
  calls: { kind: 'create' | 'get'; options: any }[] = [];
  cancelNext = false;

  addKey(opts: FakeKeyOptions = {}): number {
    this.keys.push({ opts: { prf: true, prfAtCreate: false, uv: true, ...opts }, creds: [] });
    return this.keys.length - 1;
  }

  use(i: number) {
    this.active = i;
  }

  private get key(): FakeKey {
    const k = this.keys[this.active];
    if (!k) throw new Error('no fake key');
    return k;
  }

  /** PRF output this fake would return for a credential (for test assertions). */
  async prfFor(credId: Uint8Array, salt: Uint8Array, uv = true): Promise<Uint8Array> {
    for (const k of this.keys)
      for (const c of k.creds) if (b64url(c.id) === b64url(credId)) return hmac(uv ? c.secretUv : c.secretNoUv, salt);
    throw new Error('unknown credential');
  }

  private async authData(rpId: string, extraFlags: number, attested?: Uint8Array) {
    const flags = 0x01 | (this.key.opts.uv ? 0x04 : 0) | extraFlags;
    return concat(await sha256(enc.encode(rpId)), Uint8Array.of(flags), Uint8Array.of(0, 0, 0, 1), attested ?? new Uint8Array());
  }

  readonly credentials = {
    create: async (options: CredentialCreationOptions): Promise<any> => {
      this.calls.push({ kind: 'create', options });
      if (this.cancelNext) {
        this.cancelNext = false;
        throw new DOMExceptionLike('cancelled', 'NotAllowedError');
      }
      const pk = options.publicKey!;
      const rpId = pk.rp.id!;
      const k = this.key;
      for (const ex of pk.excludeCredentials ?? []) {
        if (k.creds.some((c) => b64url(c.id) === b64url(u8(ex.id)))) throw new DOMExceptionLike('excluded', 'InvalidStateError');
      }
      const keyPair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
      const cred: Cred = { id: rand(48), rpId, keyPair, secretUv: rand(32), secretNoUv: rand(32), userId: u8(pk.user.id) };
      k.creds.push(cred);
      const spki = new Uint8Array(await crypto.subtle.exportKey('spki', keyPair.publicKey));
      const authData = await this.authData(rpId, 0x40, concat(new Uint8Array(16), Uint8Array.of(0, cred.id.length), cred.id));
      const ext: any = {};
      const prfIn = (pk.extensions as any)?.prf;
      if (prfIn) {
        ext.prf = { enabled: k.opts.prf };
        if (k.opts.prf && k.opts.prfAtCreate && prfIn.eval?.first) {
          ext.prf.results = { first: (await hmac(k.opts.uv ? cred.secretUv : cred.secretNoUv, u8(prfIn.eval.first))).buffer };
        }
      }
      return {
        type: 'public-key',
        id: b64url(cred.id),
        rawId: cred.id.slice().buffer,
        authenticatorAttachment: 'cross-platform',
        response: {
          clientDataJSON: enc.encode(JSON.stringify({ type: 'webauthn.create' })).buffer,
          attestationObject: new ArrayBuffer(0),
          getAuthenticatorData: () => authData.slice().buffer,
          getPublicKey: () => spki.slice().buffer,
          getPublicKeyAlgorithm: () => -7,
          getTransports: () => ['usb'],
        },
        getClientExtensionResults: () => ext,
      };
    },

    get: async (options: CredentialRequestOptions): Promise<any> => {
      this.calls.push({ kind: 'get', options });
      if (this.cancelNext) {
        this.cancelNext = false;
        throw new DOMExceptionLike('cancelled', 'NotAllowedError');
      }
      const pk = options.publicKey!;
      const k = this.key;
      const allow = (pk.allowCredentials ?? []).map((c) => b64url(u8(c.id)));
      const cred = k.creds.find((c) => c.rpId === pk.rpId && (allow.length === 0 || allow.includes(b64url(c.id))));
      if (!cred) throw new DOMExceptionLike('no credential', 'NotAllowedError');
      const authData = await this.authData(pk.rpId!, 0);
      const clientDataJSON = enc.encode(
        JSON.stringify({ type: 'webauthn.get', challenge: b64url(u8(pk.challenge)), origin: 'http://localhost', crossOrigin: false }),
      );
      const raw = new Uint8Array(
        await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, cred.keyPair.privateKey, concat(authData, await sha256(clientDataJSON))),
      );
      const ext: any = {};
      const prfIn = (pk.extensions as any)?.prf;
      if (prfIn && k.opts.prf) {
        ext.prf = { results: { first: (await hmac(k.opts.uv ? cred.secretUv : cred.secretNoUv, u8(prfIn.eval.first))).buffer } };
      }
      return {
        type: 'public-key',
        id: b64url(cred.id),
        rawId: cred.id.slice().buffer,
        authenticatorAttachment: 'cross-platform',
        response: {
          clientDataJSON: clientDataJSON.buffer,
          authenticatorData: authData.buffer,
          signature: derSig(raw).buffer,
          userHandle: cred.userId.slice().buffer,
        },
        getClientExtensionResults: () => ext,
      };
    },
  };

  /** Uncompressed public key x||y of a credential (for assertions). */
  async publicKeyOf(credId: Uint8Array): Promise<Uint8Array> {
    for (const k of this.keys)
      for (const c of k.creds)
        if (b64url(c.id) === b64url(credId)) return new Uint8Array(await crypto.subtle.exportKey('raw', c.keyPair.publicKey)).slice(1);
    throw new Error('unknown credential');
  }
}
