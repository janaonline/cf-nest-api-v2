import { Paragraph } from 'docx';

/**
 * The standard MoHUA addressee block, followed by one blank paragraph for spacing before that
 * letter's own Subject line. Shared by `elected-urban-local-bodies-docx.service.ts` and
 * `fc-unspent-declaration-docx.service.ts` — both letters' specimens now use this exact addressee
 * text, so it's a single source of truth again (EULB briefly forked its own local copy when its
 * specimen used different addressee text; that's no longer the case).
 */
export function buildMohuaLetterAddressBlock(): Paragraph[] {
  return [
    new Paragraph({ text: 'To,' }),
    new Paragraph({ text: 'The Deputy Secretary' }),
    new Paragraph({ text: 'Finance Commission Cell' }),
    new Paragraph({ text: 'Department of Urban Development' }),
    new Paragraph({ text: 'Ministry of Housing and Urban Affairs' }),
    new Paragraph({ text: 'Government of India' }),
    new Paragraph({ text: 'Sankalp Bhawan, New Delhi' }),
    new Paragraph({ text: '' }),
  ];
}
