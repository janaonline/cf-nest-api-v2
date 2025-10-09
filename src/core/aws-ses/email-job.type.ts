export type EmailJob = {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  from?: string;
  templateName: string;
  mailData?: Record<string, any>;
};
