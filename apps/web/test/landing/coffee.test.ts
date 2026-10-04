/** add-donation D3: the landing's coffee pill gets a Motion sheen on hover, loaded lazily; nothing under reduced motion. */
import { describe, expect, it, vi } from 'vitest';
import { wireCoffee } from '../../src/landing/boot';

const mm = (reduced: boolean, fine = true) => (q: string) => ({ matches: q.includes('reduce') ? reduced : q.includes('fine') ? fine : false }) as MediaQueryList;
function pill() {
  document.body.innerHTML = '<a class="pill coffee" data-coffee href="/support"><span class="coffee-sheen"></span>Buy me a coffee</a>';
  return document.querySelector<HTMLElement>('[data-coffee]')!;
}

describe('wireCoffee', () => {
  it('sweeps the sheen on pointer enter and focus, loading the Motion module only on first use', async () => {
    const el = pill();
    const sweep = vi.fn();
    const load = vi.fn(async () => ({ sweep }));
    wireCoffee(document, mm(false), load);
    expect(load).not.toHaveBeenCalled();
    el.dispatchEvent(new Event('pointerenter'));
    await vi.waitFor(() => expect(sweep).toHaveBeenCalledTimes(1));
    el.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(sweep).toHaveBeenCalledTimes(2));
    expect(load).toHaveBeenCalledTimes(1);
    expect(sweep).toHaveBeenCalledWith(el.querySelector('.coffee-sheen'));
  });
  it('does nothing under reduced motion', () => {
    const el = pill();
    const load = vi.fn();
    wireCoffee(document, mm(true), load as never);
    el.dispatchEvent(new Event('pointerenter'));
    expect(load).not.toHaveBeenCalled();
  });
  it('re-checks reduced motion at each hover (a later switch to reduce stops the sheen)', async () => {
    const el = pill();
    let reduced = false;
    const sweep = vi.fn();
    wireCoffee(document, (q: string) => ({ matches: q.includes('reduce') ? reduced : true }) as MediaQueryList, async () => ({ sweep }));
    reduced = true;
    el.dispatchEvent(new Event('pointerenter'));
    await new Promise((r) => setTimeout(r, 0));
    expect(sweep).not.toHaveBeenCalled();
  });
  it('a failed load is harmless (the pill is a plain link)', async () => {
    const el = pill();
    const load = vi.fn(async () => {
      throw new Error('offline');
    });
    wireCoffee(document, mm(false), load);
    el.dispatchEvent(new Event('pointerenter'));
    await new Promise((r) => setTimeout(r, 0));
    expect(el.getAttribute('href')).toBe('/support');
  });
});
