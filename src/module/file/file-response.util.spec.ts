import { buildContentDisposition } from './file-response.util';

// Node's http module rejects header values containing anything outside tab/printable-ASCII/Latin-1
// (throws "Invalid character in header content") — this is the exact invariant that crashed DUR's
// document download in production when an uploaded file's original name contained a character
// outside that range. Every case here guards against that regressing.
const HEADER_SAFE = /^[\x20-\x7e]*$/;

describe('buildContentDisposition', () => {
  it('keeps a plain ASCII filename unchanged in both fields', () => {
    const header = buildContentDisposition('application/pdf', 'report.pdf', 'attachment');

    expect(header).toContain('filename="report.pdf"');
    expect(header).toContain("filename*=UTF-8''report.pdf");
  });

  it('escapes a double quote in the legacy field without touching the RFC 5987 field', () => {
    const header = buildContentDisposition('application/pdf', 'my "report".pdf', 'attachment');

    expect(header).toContain(`filename="my 'report'.pdf"`);
    expect(header).toContain("filename*=UTF-8''my%20%22report%22.pdf");
  });

  it('strips a non-Latin1 Unicode character from the legacy field but keeps it in the RFC 5987 field', () => {
    const fileName = 'रिपोर्ट.pdf'; // Devanagari — outside the printable-ASCII/Latin-1 range Node allows
    const header = buildContentDisposition('application/pdf', fileName, 'attachment');
    const legacyField = header.match(/filename="([^"]*)"/)?.[1];

    expect(legacyField).toBeDefined();
    expect(legacyField).toMatch(HEADER_SAFE);
    expect(legacyField).not.toContain('रिपोर्ट');
    expect(header).toContain(`filename*=UTF-8''${encodeURIComponent(fileName)}`);
  });

  it('strips a control character (e.g. an embedded newline) from the legacy field', () => {
    const header = buildContentDisposition('application/pdf', 'report\r\nX-Injected: evil.pdf', 'attachment');
    const legacyField = header.match(/filename="([^"]*)"/)?.[1];

    expect(legacyField).toBeDefined();
    expect(legacyField).toMatch(HEADER_SAFE);
    expect(legacyField).not.toMatch(/[\r\n]/);
  });

  it('never produces a legacy field with header-unsafe characters, across a batch of hostile filenames', () => {
    const hostileNames = [
      'रिपोर्ट.pdf',
      '报告.pdf',
      '😀report.pdf',
      'report\u0000.pdf',
      'report\u007f.pdf',
      'em—dash’quote.pdf',
    ];

    for (const name of hostileNames) {
      const header = buildContentDisposition('application/pdf', name, 'attachment');
      const legacyField = header.match(/filename="([^"]*)"/)?.[1];
      expect(legacyField).toMatch(HEADER_SAFE);
    }
  });

  it('honors the requested disposition', () => {
    expect(buildContentDisposition('application/pdf', 'a.pdf', 'attachment')).toMatch(/^attachment;/);
    expect(buildContentDisposition('application/pdf', 'a.pdf', 'inline')).toMatch(/^inline;/);
  });
});
