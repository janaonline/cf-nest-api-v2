import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Model } from 'mongoose';
import { UlbDocument } from 'src/schemas/ulb.schema';
import { QueryTemplates } from 'src/shared/files/queryTemplates';
import { QueryResourcesSectionDto } from './dto/query-resources-section.dto';
import { ResourcesSectionService } from './resources-section.service';

describe('ResourcesSectionService', () => {
  let service: ResourcesSectionService;
  let ulbModel: jest.Mocked<Model<UlbDocument>>;

  beforeEach(async () => {
    const mockUlbModel = {
      aggregate: jest.fn().mockReturnThis(),
      exec: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResourcesSectionService,
        { provide: getModelToken('Ulb'), useValue: mockUlbModel },
        { provide: QueryTemplates, useValue: { popCatQuerySwitch: jest.fn() } },
      ],
    }).compile();

    service = module.get<ResourcesSectionService>(ResourcesSectionService);
    ulbModel = module.get(getModelToken('Ulb'));
  });

  describe('getFiles', () => {
    it('should call getRawFiles for rawPdf', async () => {
      const spy = jest
        .spyOn(service as any, 'getRawFiles')
        .mockResolvedValue({ success: true });

      const result = await service.getFiles({
        downloadType: 'rawPdf',
        year: '2021-22',
      } as QueryResourcesSectionDto);

      expect(spy).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });

    it('should return in-progress for standardizedExcel', async () => {
      const result = await service.getFiles({
        downloadType: 'standardizedExcel',
        year: '2021-22',
      } as QueryResourcesSectionDto);
      expect(result).toEqual({ msg: 'Dev in-progress' });
    });

    it('should return in-progress for budget', async () => {
      const result = await service.getFiles({
        downloadType: 'budget',
        year: '2021-22',
      } as QueryResourcesSectionDto);
      expect(result).toEqual({ msg: 'Dev in-progress' });
    });

    it('should return bad request for invalid year', async () => {
      const result = await service.getFiles({
        downloadType: 'rawPdf',
        year: '2099-00',
      } as QueryResourcesSectionDto);

      expect(result).toEqual({
        message: ['Please pass a valid year between range 2015-16 to 2026-27'],
        error: 'Bad Request',
        statusCode: 400,
      });
    });
  });

  describe('getRawFiles', () => {
    it('should build pipeline and return results', async () => {
      const fakeResult = [{ ulbId: '1', ulbName: 'Test ULB' }];

      ulbModel.aggregate.mockReturnThis();
      (ulbModel.aggregate().exec as jest.Mock).mockImplementation(
        () => fakeResult,
      );

      const query = {
        ulb: '5dd006d4ffbcc50cfd92c87c',
        year: '2021-22',
        auditType: 'audited',
        downloadType: 'rawPdf',
      } as QueryResourcesSectionDto;

      const result = await service.getRawFiles(query);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(ulbModel.aggregate as jest.Mock).toHaveBeenCalledWith(
        expect.any(Array),
      );

      expect(result).toEqual({
        success: true,
        msg: `${fakeResult.length} document(s) found for searched options.`,
        data: fakeResult,
      });
    });
  });
});
