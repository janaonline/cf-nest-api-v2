import { Test, TestingModule } from '@nestjs/testing';
import { NodeMailerService } from './node-mailer.service';
import { MailerService } from '@nestjs-modules/mailer';

describe('NodeMailerService', () => {
  let service: NodeMailerService;

  const mockMailerService = {
    sendMail: jest.fn().mockResolvedValue(true),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NodeMailerService,
        {
          provide: MailerService,
          useValue: mockMailerService,
        },
      ],
    }).compile();

    service = module.get<NodeMailerService>(NodeMailerService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('sends to every recipient when "to" is an array', async () => {
    await service.sendEmailWithTemplate(['a@example.com', 'b@example.com'], 'Subject', './welcome', { name: 'X' });

    expect(mockMailerService.sendMail).toHaveBeenCalledWith({
      to: ['a@example.com', 'b@example.com'],
      subject: 'Subject',
      template: './welcome',
      context: { name: 'X' },
    });
  });
});
