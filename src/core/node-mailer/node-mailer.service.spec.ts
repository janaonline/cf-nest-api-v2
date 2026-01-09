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
});
