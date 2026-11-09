import { stubFileSaving } from '@/test/downloads';
import { fileNameFromContentDisposition, REVOKE_DELAY_MS, saveFile } from './download';

describe('fileNameFromContentDisposition', () => {
  it.each([
    ['attachment; filename="HT-7K3M9Q2X-confirmation.pdf"', 'HT-7K3M9Q2X-confirmation.pdf'],
    ['attachment; filename=HT-7K3M9Q2X-invoice.pdf', 'HT-7K3M9Q2X-invoice.pdf'],
    ['attachment;filename="receipt.pdf";size=1024', 'receipt.pdf'],
    ['attachment; filename="old.pdf"; filename*=UTF-8\'\'R%C3%A9sum%C3%A9%20%E2%82%B9.pdf', 'Résumé ₹.pdf'],
    ['attachment; filename="say \\"hi\\".pdf"', 'say "hi".pdf'],
  ])('reads %s', (header, expected) => {
    expect(fileNameFromContentDisposition(header)).toBe(expected);
  });

  it('never returns a path, only the file name', () => {
    expect(fileNameFromContentDisposition('attachment; filename="../../etc/passwd"')).toBe('passwd');
    expect(fileNameFromContentDisposition('attachment; filename="C:\\\\Windows\\\\evil.pdf"')).toBe('evil.pdf');
  });

  it('falls back to the plain name when the encoded one is broken', () => {
    expect(fileNameFromContentDisposition('attachment; filename*=UTF-8\'\'%E0%A4%A; filename="plain.pdf"')).toBe('plain.pdf');
  });

  it.each([undefined, null, '', 'attachment', 'inline; filename=""', 'attachment; filename=".."'])('returns null for %s', (header) => {
    expect(fileNameFromContentDisposition(header)).toBeNull();
  });
});

describe('saveFile', () => {
  afterEach(() => vi.useRealTimers());

  it('saves the blob under the name through a temporary object URL, then releases the URL', () => {
    vi.useFakeTimers();
    const files = stubFileSaving();
    const pdf = new Blob(['%PDF-1.7'], { type: 'application/pdf' });

    saveFile(pdf, 'HT-7K3M9Q2X-confirmation.pdf');

    expect(files.blobs).toEqual([pdf]);
    expect(files.saved).toEqual([{ href: 'blob:http://localhost/file-1', fileName: 'HT-7K3M9Q2X-confirmation.pdf' }]);
    // The link is gone from the page at once; the URL lives a moment longer so the browser can start the download.
    expect(document.querySelector('a[download]')).toBeNull();
    expect(files.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(REVOKE_DELAY_MS);
    expect(files.revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/file-1');
  });
});
