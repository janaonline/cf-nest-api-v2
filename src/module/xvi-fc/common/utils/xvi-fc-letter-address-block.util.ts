import { Paragraph } from 'docx';

/**
 * The standard MoHUA addressee block, followed by one blank paragraph for spacing before that
 * letter's own Subject line. Used by `fc-unspent-declaration-docx.service.ts`.
 *
 * `elected-urban-local-bodies-docx.service.ts` previously shared this util too, but its specimen
 * letter now uses different addressee text (a distinct MoHUA format) and forks its own
 * `buildAddressBlock()` locally instead — do not repoint EULB back at this util without checking
 * its addressee text still matches its own specimen.
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
