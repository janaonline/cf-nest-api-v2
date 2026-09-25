import { Document, Packer } from 'docx';
import JSZip from 'jszip';
import { buildMohuaLetterAddressBlock } from './xvi-fc-letter-address-block.util';

/** Unzips a generated .docx and returns the main body's raw XML — `docx`'s `Paragraph` doesn't
 *  expose its plain text directly, so asserting on real rendered content (mirroring the pattern
 *  used by both docx services' own specs) is more trustworthy than trusting the library's API surface. */
async function extractDocumentXml(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file('word/document.xml');
  if (!file) throw new Error('word/document.xml missing from generated docx');
  return file.async('text');
}

describe('buildMohuaLetterAddressBlock', () => {
  it('returns 6 paragraphs: the 5-line addressee block plus one trailing blank', () => {
    expect(buildMohuaLetterAddressBlock()).toHaveLength(6);
  });

  it('renders the exact addressee text, and none of the old address', async () => {
    const doc = new Document({ sections: [{ properties: {}, children: buildMohuaLetterAddressBlock() }] });
    const xml = await extractDocumentXml(await Packer.toBuffer(doc));

    expect(xml).toContain('To,');
    expect(xml).toContain('Economic Advisor/ Deputy Secretary (Finance Commission Cell)');
    expect(xml).toContain('Ministry of Housing and Urban Affairs,');
    expect(xml).toContain('Sankalp Bhawan, GPOA-2, Pt. Ravi Shankar Shukla Lane,');
    expect(xml).toContain('Kasturba Gandhi Marg, New Delhi-110001');
    expect(xml).not.toContain('The Director,');
    expect(xml).not.toContain('AMRUT-IIB');
    expect(xml).not.toContain('Government of India,');
  });
});
