import { BankAccountController } from './bank-account.controller';
import { BankAccountService } from './bank-account.service';

describe('BankAccountController', () => {
  let controller: BankAccountController;
  let service: { lookupIfsc: jest.Mock; getFormConfig: jest.Mock };

  beforeEach(() => {
    service = {
      getFormConfig: jest.fn().mockResolvedValue({ meta: {}, data: [] }),
      lookupIfsc: jest.fn().mockResolvedValue({
        success: true,
        message: 'IFSC details fetched.',
        data: {
          ifscCode: 'UTIB0005157',
          bankDetails: {
            name: 'Axis Bank',
            branch: 'Indore Main',
            address: 'MG Road, Indore',
            city: 'Indore',
            state: 'Madhya Pradesh',
            micr: null,
          },
        },
        timestamp: '2026-01-01T00:00:00.000Z',
      }),
    };

    controller = new BankAccountController(service as unknown as BankAccountService);
  });

  it('delegates IFSC lookup to BankAccountService', async () => {
    await expect(controller.lookupIfsc('utib0005157')).resolves.toMatchObject({
      success: true,
      message: 'IFSC details fetched.',
    });
    expect(service.lookupIfsc).toHaveBeenCalledWith('utib0005157');
  });

  it('delegates form-config lookup to BankAccountService with the given yearId', async () => {
    await expect(controller.getFormConfig('year-1')).resolves.toEqual({ meta: {}, data: [] });
    expect(service.getFormConfig).toHaveBeenCalledWith('year-1');
  });
});
