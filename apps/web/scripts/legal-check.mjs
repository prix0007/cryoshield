/** add-privacy-and-compliance 3.3: a legal page may keep placeholders only while it shows the draft banner. */
export const PLACEHOLDERS = ['[ENTITY]', '[REGISTERED ADDRESS]', '[GRIEVANCE OFFICER]', '[CONTACT EMAIL]'];
export const DRAFT_BANNER = 'Draft, pending legal review';

export function checkLegalDraft(html, name) {
  if (html.includes(DRAFT_BANNER)) return [];
  return PLACEHOLDERS.filter((p) => html.includes(p)).map((p) => `${name}: placeholder ${p} without the "${DRAFT_BANNER}" banner`);
}

/** Storage APIs referenced by shipped JS that the device-storage inventory (legal/storage-inventory.json) omits. */
export const STORAGE_APIS = ['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie', 'caches.open', 'serviceWorker.register', 'cookieStore'];
export function unlistedStorageApis(js, inventory) {
  return STORAGE_APIS.filter((api) => js.includes(api) && !inventory.apis.includes(api));
}
