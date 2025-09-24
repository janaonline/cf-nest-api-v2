import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
// import { Model } from 'mongoose';
// import { UlbDocument } from 'src/schemas/ulb.schema';
import { BadRequestException } from '@nestjs/common';
import { QueryResourcesSectionDto } from './dto/query-resources-section.dto';
import { ResourcesSectionService } from './resources-section.service';

describe('ResourcesSectionService', () => {
  let service: ResourcesSectionService;
  // let ulbModel: jest.Mocked<Model<UlbDocument>>;
  // const results = [];

  beforeEach(async () => {
    const mockModel = {
      aggregate: jest.fn().mockReturnThis(),
      exec: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResourcesSectionService,
        { provide: getModelToken('Ulb'), useValue: mockModel },
        { provide: getModelToken('DataCollectionForm'), useValue: mockModel },
        { provide: getModelToken('BudgetDocument'), useValue: mockModel },
      ],
    }).compile();

    service = module.get<ResourcesSectionService>(ResourcesSectionService);
    // ulbModel = module.get(getModelToken('Ulb'));
  });

  const payload: QueryResourcesSectionDto = {
    ulb: '5dd006d4ffbcc50cfd92c87c',
    state: '5dcf9d7316a06aed41c748ec',
    ulbType: '5dcfa67543263a0e75c71697',
    popCat: '500K-1M',
    auditType: 'audited',
    year: '',
    downloadType: 'rawPdf',
  };
  const resolveValue = { success: true, message: '', data: [] };

  describe('getFiles()', () => {
    it('should return bad request if either state or ulb is not present', async () => {
      const invalidQuery: QueryResourcesSectionDto = {
        downloadType: 'rawPdf',
        year: '2020-21',
        ulb: '',
        state: '',
        ulbType: '',
        popCat: '',
        auditType: 'audited',
      };

      await expect(service.getFiles(invalidQuery)).rejects.toThrow(
        BadRequestException,
      );

      await expect(service.getFiles(invalidQuery)).rejects.toMatchObject({
        response: {
          message: ['Either ULB or State is required.'],
          error: 'Bad Request',
          statusCode: 400,
        },
      });
    });

    it('should call getRawFiles1920Onwards() if downloadType is rawPdf & year is 2019-20 onwards', async () => {
      const query: QueryResourcesSectionDto = {
        ...payload,
        year: '2020-21',
      };

      const spy = jest
        .spyOn(service, 'getRawFiles1920Onwards')
        .mockResolvedValue(resolveValue);

      await service.getFiles(query);

      expect(spy).toHaveBeenCalledWith(query);
      spy.mockRestore();
    });

    it('should call getRawFilesBefore1920() if downloadType is rawPdf & year is before 2019-20', async () => {
      const query: QueryResourcesSectionDto = {
        ...payload,
        year: '2018-19',
      };

      const spy = jest
        .spyOn(service, 'getRawFilesBefore1920')
        .mockResolvedValue(resolveValue);

      await service.getRawFilesBefore1920(query);

      expect(spy).toHaveBeenCalledWith(query);
      spy.mockRestore();
    });

    it('should return in-progress when downloadType is standardizedExcel', async () => {
      const query: QueryResourcesSectionDto = {
        ...payload,
        downloadType: 'standardizedExcel',
      };

      const reponse = await service.getFiles(query);
      expect(reponse.message).toMatch('in-progress');
    });

    it('should call getBudget() when downloadType is budget', async () => {
      const query: QueryResourcesSectionDto = {
        ...payload,
        downloadType: 'budget',
      };

      const spy = jest
        .spyOn(service, 'getBudget')
        .mockResolvedValue(resolveValue);

      await service.getFiles(query);

      expect(spy).toHaveBeenCalledWith(query);
      spy.mockRestore();
    });
  });
});
