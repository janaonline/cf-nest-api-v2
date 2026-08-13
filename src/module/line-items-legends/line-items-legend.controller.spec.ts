import { Test, TestingModule } from '@nestjs/testing';
import { RolesGuard } from 'src/module/auth/guards/roles.guard';
import { CreateLineItemsLegendDto } from './dto/create-line-items-legend.dto';
import { ImportLineItemsTemplateDto } from './dto/import-line-items-template.dto';
import { ListLineItemsLegendQueryDto } from './dto/list-line-items-legend-query.dto';
import { UpdateLineItemsLegendDto } from './dto/update-line-items-legend.dto';
import { LineItemsLegendController } from './line-items-legend.controller';
import { LineItemsLegendService } from './line-items-legend.service';

const mockService = {
  listLegends: jest.fn().mockResolvedValue({ data: [], meta: { total: 0 } }),
  getLegend: jest.fn().mockResolvedValue({ nmamCode: '110', label: 'Total Income' }),
  importFromJson: jest.fn().mockResolvedValue({ imported: 5, skipped: 0 }),
  createLegend: jest.fn().mockResolvedValue({ nmamCode: '110', label: 'Total Income' }),
  updateLegend: jest.fn().mockResolvedValue({ nmamCode: '110', label: 'Updated' }),
  deleteLegendSubtree: jest.fn().mockResolvedValue({ deleted: 3 }),
  deleteLegend: jest.fn().mockResolvedValue({ nmamCode: '110' }),
};

describe('LineItemsLegendController', () => {
  let controller: LineItemsLegendController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LineItemsLegendController],
      providers: [{ provide: LineItemsLegendService, useValue: mockService }],
    })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get<LineItemsLegendController>(LineItemsLegendController);
  });

  it('should be defined', () => expect(controller).toBeDefined());

  describe('listLegends', () => {
    it('delegates to service.listLegends with query', async () => {
      const query = new ListLineItemsLegendQueryDto();
      await controller.listLegends(query);
      expect(mockService.listLegends).toHaveBeenCalledWith(query);
    });
  });

  describe('getLegend', () => {
    it('delegates to service.getLegend with nmamCode and templateVersion', async () => {
      await controller.getLegend('110', '2026.1');
      expect(mockService.getLegend).toHaveBeenCalledWith('110', '2026.1');
    });

    it('passes undefined templateVersion when omitted', async () => {
      await controller.getLegend('110', undefined);
      expect(mockService.getLegend).toHaveBeenCalledWith('110', undefined);
    });
  });

  describe('importTemplate', () => {
    it('delegates to service.importFromJson with dto', async () => {
      const dto = { lineItems: [] } as ImportLineItemsTemplateDto;
      await controller.importTemplate(dto);
      expect(mockService.importFromJson).toHaveBeenCalledWith(dto);
    });
  });

  describe('createLegend', () => {
    it('delegates to service.createLegend with dto', async () => {
      const dto = { nmamCode: '110', label: 'Total Income' } as unknown as CreateLineItemsLegendDto;
      await controller.createLegend(dto);
      expect(mockService.createLegend).toHaveBeenCalledWith(dto);
    });
  });

  describe('updateLegend', () => {
    it('delegates to service.updateLegend with nmamCode, templateVersion, and dto', async () => {
      const dto = { label: 'Updated' } as UpdateLineItemsLegendDto;
      await controller.updateLegend('110', '2026.1', dto);
      expect(mockService.updateLegend).toHaveBeenCalledWith('110', '2026.1', dto);
    });
  });

  describe('deleteLegendSubtree', () => {
    it('delegates to service.deleteLegendSubtree with nmamCode and templateVersion', async () => {
      await controller.deleteLegendSubtree('110', '2026.1');
      expect(mockService.deleteLegendSubtree).toHaveBeenCalledWith('110', '2026.1');
    });
  });

  describe('deleteLegend', () => {
    it('delegates to service.deleteLegend with nmamCode and templateVersion', async () => {
      await controller.deleteLegend('110', '2026.1');
      expect(mockService.deleteLegend).toHaveBeenCalledWith('110', '2026.1');
    });
  });
});
