/** In-memory Turbo upload + Arweave gateway (GraphQL + data) behind page.route (task 2.5). */
import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';

export interface StoredItem {
  id: string;
  tags: { name: string; value: string }[];
  data: Buffer;
}

function u64(b: Buffer, o: number) {
  return Number(b.readBigUInt64LE(o));
}

function avroLong(b: Buffer, o: number): [number, number] {
  let n = 0;
  let shift = 0;
  let byte;
  do {
    byte = b[o++]!;
    n += (byte & 0x7f) * 2 ** shift;
    shift += 7;
  } while (byte & 0x80);
  return [n % 2 === 0 ? n / 2 : -(n + 1) / 2, o];
}

/** Parses an Ethereum-signed ANS-104 item enough to index tags and data (signature checked in unit tests). */
export function parseDataItem(b: Buffer): StoredItem {
  if (b.readUInt16LE(0) !== 3) throw new Error('not an ethereum data item');
  let o = 2 + 65 + 65;
  if (b[o++] === 1) o += 32;
  if (b[o++] === 1) o += 32;
  const nTags = u64(b, o);
  const nTagBytes = u64(b, o + 8);
  o += 16;
  const tagBytes = b.subarray(o, o + nTagBytes);
  const data = b.subarray(o + nTagBytes);
  const tags: { name: string; value: string }[] = [];
  let t = 0;
  if (nTags > 0) {
    let count;
    [count, t] = avroLong(tagBytes, t);
    for (let i = 0; i < count; i++) {
      let len;
      [len, t] = avroLong(tagBytes, t);
      const name = tagBytes.subarray(t, t + len).toString();
      t += len;
      [len, t] = avroLong(tagBytes, t);
      const value = tagBytes.subarray(t, t + len).toString();
      t += len;
      tags.push({ name, value });
    }
  }
  const sig = b.subarray(2, 67);
  const id = createHash('sha256').update(sig).digest('base64url');
  return { id, tags, data: Buffer.from(data) };
}

export class ArweaveStub {
  items: StoredItem[] = [];
  failUploads = false;

  async install(page: Page) {
    await page.route('https://upload.ardrive.io/**', async (route) => {
      if (this.failUploads) return route.fulfill({ status: 503, body: 'unavailable' });
      const item = parseDataItem(route.request().postDataBuffer()!);
      this.items.push(item);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: item.id }) });
    });
    await page.route('https://arweave.net/**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/graphql') {
        const { variables } = route.request().postDataJSON();
        const filters: { name: string; values: string[] }[] = variables.tags;
        const hits = this.items.filter((it) => filters.every((f) => it.tags.some((t) => t.name === f.name && f.values.includes(t.value))));
        return route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ data: { transactions: { edges: hits.reverse().map((h) => ({ node: { id: h.id, data: { size: String(h.data.length) } } })) } } }),
        });
      }
      const id = url.pathname.slice(1);
      const it = this.items.find((x) => x.id === id);
      return it ? route.fulfill({ status: 200, body: it.data }) : route.fulfill({ status: 404 });
    });
  }

  byLocator(locator: string) {
    return this.items.filter((i) => i.tags.some((t) => t.name === 'CryoShield-Locator' && t.value === locator.toLowerCase()));
  }
}
