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
  it('returns 8 paragraphs: the 7-line addressee block plus one trailing blank', () => {
    expect(buildMohuaLetterAddressBlock()).toHaveLength(8);
  });

  it('renders the exact addressee text, and none of the old address', async () => {
    const doc = new Document({ sections: [{ properties: {}, children: buildMohuaLetterAddressBlock() }] });
    const xml = await extractDocumentXml(await Packer.toBuffer(doc));

    expect(xml).toContain('To,');
    expect(xml).toContain('The Deputy Secretary');
    expect(xml).toContain('Finance Commission Cell');
    expect(xml).toContain('Department of Urban Development');
    expect(xml).toContain('Ministry of Housing and Urban Affairs');
    expect(xml).toContain('Government of India');
    expect(xml).toContain('Sankalp Bhawan, New Delhi');
    expect(xml).not.toContain('Economic Advisor/ Deputy Secretary (Finance Commission Cell)');
    expect(xml).not.toContain('Sankalp Bhawan, GPOA-2, Pt. Ravi Shankar Shukla Lane,');
    expect(xml).not.toContain('Kasturba Gandhi Marg, New Delhi-110001');
    expect(xml).not.toContain('The Director,');
    expect(xml).not.toContain('AMRUT-IIB');
  });
});
