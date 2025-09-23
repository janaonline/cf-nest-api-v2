import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Model } from 'mongoose';
import { UlbDocument } from 'src/schemas/ulb.schema';
import { QueryTemplates } from 'src/shared/queryTemplates';
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
      } as QueryResourcesSectionDto);

      expect(spy).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });

    it('should return in-progress for standardizedExcel', async () => {
      const result = await service.getFiles({
        downloadType: 'standardizedExcel',
      } as QueryResourcesSectionDto);
      expect(result).toEqual({ msg: 'Dev in-progress' });
    });

    it('should return in-progress for budget', async () => {
      const result = await service.getFiles({
        downloadType: 'budget',
      } as QueryResourcesSectionDto);
      expect(result).toEqual({ msg: 'Dev in-progress' });
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
        year: '606aaf854dff55e6c075d219',
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
