import { AppService } from './app.service';

describe('AppService', () => {
  let service: AppService;

  beforeEach(() => {
    service = new AppService();
  });

  describe('getHello()', () => {
    it('returns "Hello World!"', () => {
      expect(service.getHello()).toBe('Hello World!');
    });

    it('returns a string', () => {
      expect(typeof service.getHello()).toBe('string');
    });

    it('returns the same value on repeated calls', () => {
      expect(service.getHello()).toBe(service.getHello());
    });
  });
});
