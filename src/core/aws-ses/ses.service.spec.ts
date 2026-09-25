const mockSend = jest.fn();

jest.mock('@aws-sdk/client-sesv2', () => ({
  SESv2Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
  SendEmailCommand: jest.fn().mockImplementation((input: any) => ({ input })),
}));

import { SESMailService } from './ses.service';

describe('SESMailService', () => {
  let service: SESMailService;

  beforeEach(() => {
    service = new SESMailService();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('sendEmail()', () => {
    it('should send an email to a single recipient with default from address', async () => {
      mockSend.mockResolvedValue({ MessageId: 'msg-1' });

      const result = await service.sendEmail({
        to: 'user@example.com',
        subject: 'Hello',
        html: '<p>Hi there</p>',
      });

      expect(mockSend).toHaveBeenCalledTimes(1);
      const commandArg = mockSend.mock.calls[0][0];
      expect(commandArg.input).toEqual({
        FromEmailAddress: 'updates@cityfinance.in',
        Destination: { ToAddresses: ['user@example.com'] },
        Content: {
          Simple: {
            Subject: { Data: 'Hello' },
            Body: { Html: { Data: '<p>Hi there</p>' } },
          },
        },
      });
      expect(result).toEqual({ MessageId: 'msg-1' });
    });

    it('should support multiple recipients and a custom from address', async () => {
      mockSend.mockResolvedValue({ MessageId: 'msg-2' });

      await service.sendEmail({
        to: ['a@example.com', 'b@example.com'],
        subject: 'Bulk',
        html: '<p>Bulk</p>',
        from: 'custom@cityfinance.in',
      });

      const commandArg = mockSend.mock.calls[0][0];
      expect(commandArg.input.FromEmailAddress).toBe('custom@cityfinance.in');
      expect(commandArg.input.Destination.ToAddresses).toEqual(['a@example.com', 'b@example.com']);
    });

    it('should log and rethrow when the SES client fails', async () => {
      const error = new Error('SES unavailable');
      mockSend.mockRejectedValue(error);

      await expect(
        service.sendEmail({
          to: 'user@example.com',
          subject: 'Hello',
          html: '<p>Hi</p>',
        }),
      ).rejects.toThrow('SES unavailable');
    });
  });

  describe('sendEmailTemplate()', () => {
    it('should compile the resource-zip-ready template and send it', async () => {
      mockSend.mockResolvedValue({ MessageId: 'msg-3' });

      await service.sendEmailTemplate({
        to: 'user@example.com',
        subject: 'Your data is ready',
        mailData: {
          name: 'Jeeva',
          download_link: 'https://cityfinance.in/download/abc',
          downloadType: 'Annual Accounts',
          state: 'Karnataka',
          year: '2025',
        },
      });

      expect(mockSend).toHaveBeenCalledTimes(1);
      const commandArg = mockSend.mock.calls[0][0];
      const html: string = commandArg.input.Content.Simple.Body.Html.Data;
      expect(html).toContain('Jeeva');
      expect(html).toContain('https://cityfinance.in/download/abc');
      expect(html).toContain('Annual Accounts');
      expect(commandArg.input.Content.Simple.Subject.Data).toBe('Your data is ready');
    });

    it('should log and rethrow when sending the compiled template fails', async () => {
      const error = new Error('SES send failed');
      mockSend.mockRejectedValue(error);

      await expect(
        service.sendEmailTemplate({
          to: 'user@example.com',
          subject: 'Your data is ready',
          mailData: { name: 'Jeeva' },
        }),
      ).rejects.toThrow('SES send failed');
    });
  });
});
