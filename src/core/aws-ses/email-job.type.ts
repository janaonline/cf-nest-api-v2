/**
 * `content` is base64 text, not a Buffer — BullMQ job data is JSON-serialized (stored in Redis),
 * and a Buffer round-tripped through JSON.stringify/parse comes back as a plain
 * `{ type: 'Buffer', data: number[] }` object, not a real Buffer, which nodemailer can't use.
 * Base64 survives that round trip intact; nodemailer accepts `{ content, encoding: 'base64' }`.
 */
export type EmailAttachment = {
  filename: string;
  content: string;
  contentType?: string;
};

export type EmailJob = {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  from?: string;
  templateName?: string;
  mailData?: Record<string, any>;
  attachments?: EmailAttachment[];
};
