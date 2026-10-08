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

/**
 * add-theme-switch D5: a listed storage API may appear only in the shipped asset its `apiFiles` entry names
 * (`assets/<prefix>-<hash>.js`) AND that the pages actually load (`referenced`, dist-relative paths taken from the
 * pages' script tags), so the theme exception can't cover storage use anywhere else, not even in a stray
 * theme-named file. `files` maps dist-relative paths to their text.
 */
export function storageApiOutsideAllowedFiles(files, inventory, referenced = []) {
  const out = [];
  for (const api of inventory.apis) {
    const prefix = inventory.apiFiles?.[api];
    const shape = prefix ? new RegExp(`^assets/${prefix}-[0-9a-f]{8}\\.js$`) : null;
    const allowed = new Set(shape ? referenced.filter((f) => shape.test(f)) : []);
    for (const [name, text] of Object.entries(files)) {
      if (text.includes(api) && !allowed.has(name)) out.push(`${name} uses ${api} (allowed only in ${allowed.size ? [...allowed].join(', ') : 'no file'})`);
    }
  }
  return out;
}
