import { Paragraph } from 'docx';

/**
 * The standard MoHUA addressee block every xvi-fc declaration letter opens with, followed by
 * one blank paragraph for spacing before that letter's own Subject line. Shared by
 * `elected-urban-local-bodies-docx.service.ts` and `fc-unspent-declaration-docx.service.ts` —
 * previously hand-duplicated identically in both files.
 */
export function buildMohuaLetterAddressBlock(): Paragraph[] {
  return [
    new Paragraph({ text: 'To,' }),
    new Paragraph({ text: 'Economic Advisor/ Deputy Secretary (Finance Commission Cell)' }),
    new Paragraph({ text: 'Ministry of Housing and Urban Affairs,' }),
    new Paragraph({ text: 'Sankalp Bhawan, GPOA-2, Pt. Ravi Shankar Shukla Lane,' }),
    new Paragraph({ text: 'Kasturba Gandhi Marg, New Delhi-110001' }),
    new Paragraph({ text: '' }),
  ];
}
