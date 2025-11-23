import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AfsDigitizationService } from './afs-digitization.service';
import { AfsDumpService } from './afs-dump.service';
import { DigitizationReportQueryDto } from './dto/digitization-report-query.dto';

@Controller('afs-digitization')
export class AfsDigitizationController {
  constructor(
    // @InjectModel(AfsMetric.name, 'CONNECTION_2')
    // private afsMetricModel: Model<AfsMetricDocument>,

    private afsService: AfsDigitizationService,
    private afsDumpService: AfsDumpService,
  ) {}

  // For dev only - To be removed.
  // @Get()
  // async test() {
  //   const result = await this.afsMetricModel.insertOne({});
  //   return result;
  // }

  // TODO: verify token - Only 'AFS_ADMIN' role is allowed.
  @Get('afs-filters')
  async getAfsFilters() {
    return await this.afsService.getAfsFilters();
  }

  @Get('dump-report')
  async dumpAfsReport() {
    return await this.afsDumpService.dumpReport();
  }

  @Get('afsexcelfiles')
  // async downloadAfsExcelFiles(@Query('yearId') yearId: string, @Query('ulbId') ulbId?: string, @Res() res: Response) {
  async downloadAfsExcelFiles(@Query() query: DigitizationReportQueryDto, @Res() res: Response) {
    // const params = { auditedYearId: yearId, ulbId: ulbId, docType: 'bal_sheet' };
    const buffer = await this.afsDumpService.exportAfsExcelFiles(query);
    //sdd
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="afsexcelfiles.xlsx"');

    return res.send(buffer);
  }

  @Get('with-afs')
  async getWithAfs(@Query() query: DigitizationReportQueryDto) {
    return await this.afsDumpService.getAnnualWithAfsExcel(query);
  }
}
