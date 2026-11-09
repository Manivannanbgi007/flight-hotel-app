import { vi, type Mock } from 'vitest';

/**
 * jsdom cannot save files: stubs `URL.createObjectURL` / `revokeObjectURL` and the `<a download>` click, and records
 * every "saved" file (its blob URL and name). Call it in the test (or `beforeEach`) that downloads something.
 */
export function stubFileSaving() {
  const blobs: Blob[] = [];
  const saved: { href: string; fileName: string }[] = [];
  const createObjectURL = vi.fn((blob: Blob) => {
    blobs.push(blob);
    return `blob:http://localhost/file-${blobs.length}`;
  });
  const revokeObjectURL: Mock<(url: string) => void> = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: createObjectURL });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: revokeObjectURL });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
    saved.push({ href: this.href, fileName: this.download });
  });
  return { blobs, saved, createObjectURL, revokeObjectURL };
}
