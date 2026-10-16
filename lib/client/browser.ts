// Small wrappers around browser APIs that can throw. localStorage throws in some
// private-browsing modes and when the quota is full; the app should keep working.

export const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  // Returns false when the value couldn't be saved (for example, storage is full).
  set(key: string, value: string): boolean {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {}
  },
};

export function download(name: string, type: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking straight after click() can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
