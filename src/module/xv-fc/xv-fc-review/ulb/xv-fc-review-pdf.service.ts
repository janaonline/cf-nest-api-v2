import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';

export type XvFcCurrency = 'INR' | 'LAKH' | 'CRORE';

interface PdfLineItem {
  code: string;
  name: string | null;
  standardizedAmount: number | null;
}

interface BuildPdfParams {
  ulbName: string;
  financialYear: string;
  lineItems: PdfLineItem[];
}

function formatAmount(amount: number | null, currency: XvFcCurrency): string {
  if (amount === null || amount === undefined) return '-';
  const divisor = currency === 'CRORE' ? 1e7 : currency === 'LAKH' ? 1e5 : 1;
  return (amount / divisor).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

@Injectable()
export class XvFcReviewPdfService {
  buildLineItemsPdf(params: BuildPdfParams, currency: XvFcCurrency = 'INR'): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(14).text(`Standardised Financial Statement — ${params.ulbName}`);
      doc.fontSize(11).text(`Financial Year: ${params.financialYear}   |   Currency: ${currency}`);
      doc.moveDown();

      const columns = { code: 40, name: 100, amount: 420 };
      doc.fontSize(9).text('Code', columns.code, doc.y, { continued: true, width: 60 });
      doc.text('Line Item', columns.name, doc.y, { continued: true, width: 320 });
      doc.text('Amount', columns.amount, doc.y);
      doc.moveDown(0.5);
      doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke();
      doc.moveDown(0.3);

      for (const item of params.lineItems) {
        const y = doc.y;
        doc.fontSize(9).text(item.code, columns.code, y, { width: 55 });
        doc.text(item.name ?? '-', columns.name, y, { width: 300 });
        doc.text(formatAmount(item.standardizedAmount, currency), columns.amount, y, { width: 115, align: 'right' });
        doc.moveDown(0.4);
        if (doc.y > 760) doc.addPage();
      }

      doc.end();
    });
  }
}
