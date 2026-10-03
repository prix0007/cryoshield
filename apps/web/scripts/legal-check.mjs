/**
 * adopt-oss-project-defaults D3: no shipped file may contain a bracketed ALL-CAPS placeholder (e.g. [ENTITY],
 * [CONTACT EMAIL]) or an @cryoshield.app address (no project mailbox exists; contact is GitHub only).
 */
export function checkNoPlaceholders(text, name) {
  const out = [];
  for (const m of new Set(text.match(/\[[A-Z][A-Z ]{2,}\]/g) ?? [])) out.push(`${name}: placeholder ${m}`);
  for (const m of new Set(text.match(/[A-Za-z0-9._%+-]+@cryoshield\.app/g) ?? [])) out.push(`${name}: address ${m}`);
  return out;
}

/** Storage APIs referenced by shipped JS that the device-storage inventory (legal/storage-inventory.json) omits. */
export const STORAGE_APIS = ['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie', 'caches.open', 'serviceWorker.register', 'cookieStore'];
export function unlistedStorageApis(js, inventory) {
  return STORAGE_APIS.filter((api) => js.includes(api) && !inventory.apis.includes(api));
}
