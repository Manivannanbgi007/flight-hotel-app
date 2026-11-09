/** How long a `blob:` URL stays alive after the click: long enough for every browser to start the download. */
export const REVOKE_DELAY_MS = 1_000;

/**
 * The file name of a `Content-Disposition` header (RFC 6266): `filename*=UTF-8''…` wins over `filename="…"`.
 * Only the last path segment is kept, so a name can never point into another folder. Null when there is none.
 */
export function fileNameFromContentDisposition(header: string | null | undefined): string | null {
  if (!header) {
    return null;
  }
  const extended = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(header);
  if (extended?.[2]) {
    try {
      const name = cleanFileName(decodeURIComponent(extended[2].trim().replace(/^"(.*)"$/, '$1')));
      if (name) return name;
    } catch {
      // Badly encoded: fall back to the plain parameter.
    }
  }
  const quoted = /(?:^|;)\s*filename\s*=\s*"((?:[^"\\]|\\.)*)"/i.exec(header);
  if (quoted?.[1] !== undefined) {
    return cleanFileName(quoted[1].replace(/\\(.)/g, '$1'));
  }
  const plain = /(?:^|;)\s*filename\s*=\s*([^;"]+)/i.exec(header);
  return plain?.[1] ? cleanFileName(plain[1]) : null;
}

function cleanFileName(name: string): string | null {
  const lastSegment = name.split(/[/\\]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = lastSegment.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return cleaned && cleaned !== '.' && cleaned !== '..' ? cleaned : null;
}

/**
 * Starts a download of a same-origin URL that needs no bearer token (a one-time link from the server): the browser's
 * own download manager streams it to disk, so a file of a gigabyte never passes through JavaScript memory. The
 * `download` attribute keeps the app on screen even if the server answers with an error; the server's
 * `Content-Disposition` names the file.
 */
export function openDownloadLink(url: string, fileName = ''): void {
  // Only paths of this site (never another origin, never `javascript:`).
  if (!url.startsWith('/') || url.startsWith('//')) {
    throw new Error('Not a download link of this site');
  }
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
  }
}

/**
 * Saves a file that is already in memory (fetched with the bearer token): a temporary `blob:` URL, a click on a hidden
 * `<a download>`, then the URL is released.
 */
export function saveFile(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
  }
}
