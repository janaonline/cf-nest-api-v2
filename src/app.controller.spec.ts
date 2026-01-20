import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;
  let appService: AppService;

  const mockAppService = {
    getHello: jest.fn(),
  };

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: AppService,
          useValue: mockAppService,
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
    appService = app.get<AppService>(AppService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(appController).toBeDefined();
  });

  it('should have AppService injected', () => {
    expect(appService).toBeDefined();
  });

  describe('getHello()', () => {
    it('should return "Hello World!"', () => {
      mockAppService.getHello.mockReturnValue('Hello World!');

      const result = appController.getHello();

      expect(result).toBe('Hello World!');
      expect(mockAppService.getHello).toHaveBeenCalled();
      expect(mockAppService.getHello).toHaveBeenCalledTimes(1);
    });

    it('should return a string from service', () => {
      mockAppService.getHello.mockReturnValue('Test message');

      const result = appController.getHello();

      expect(typeof result).toBe('string');
      expect(result).toEqual('Test message');
    });

    it('should call AppService.getHello method', () => {
      mockAppService.getHello.mockReturnValue('Hello World!');

      appController.getHello();

      expect(mockAppService.getHello).toHaveBeenCalled();
    });
  });
});
