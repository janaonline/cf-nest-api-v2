import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { NodeMailerController } from './node-mailer.controller';
import { NodeMailerService } from './node-mailer.service';
import { EMAIL_QUEUE } from '../queue/email-queue/email-queue.constant';

describe('NodeMailerController', () => {
  let controller: NodeMailerController;
  let service: NodeMailerService;

  const mockMailerService = {
    sendMail: jest.fn().mockResolvedValue(true),
  };

  const mockNodeMailerService = {
    sendWelcomeEmail: jest.fn().mockResolvedValue(true),
    sendEmailWithTemplate: jest.fn().mockResolvedValue(true),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NodeMailerController],
      providers: [
        {
          provide: NodeMailerService,
          useValue: mockNodeMailerService,
        },
        {
          provide: 'MailerService',
          useValue: mockMailerService,
        },
        {
          provide: getQueueToken(EMAIL_QUEUE),
          useValue: {
            getJob: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<NodeMailerController>(NodeMailerController);
    service = module.get<NodeMailerService>(NodeMailerService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should have NodeMailerService injected', () => {
    expect(service).toBeDefined();
  });
});
