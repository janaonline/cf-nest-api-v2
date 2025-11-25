import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AfsDigitizationService } from './afs-digitization.service';
import { AfsDumpService } from './afs-dump.service';
import { DigitizationReportQueryDto } from './dto/digitization-report-query.dto';
import { Types } from 'mongoose';
import { YearIdToLabel } from 'src/core/constants/years';

@Controller('afs-digitization')
export class AfsDigitizationController {
  constructor(
    // @InjectModel(AfsMetric.name, 'CONNECTION_2')
    // private afsMetricModel: Model<AfsMetricDocument>,

    private afsService: AfsDigitizationService,
    private afsDumpService: AfsDumpService,
  ) {}

  @Get('dump-report')
  async dumpAfsReport() {
    return await this.afsDumpService.dumpReport();
  }

  @Get('afsexcelfiles')
  // async downloadAfsExcelFiles(@Query('yearId') yearId: string, @Query('ulbId') ulbId?: string, @Res() res: Response) {
  async downloadAfsExcelFiles(@Query() query: DigitizationReportQueryDto, @Res() res: Response) {
    query.yearId = new Types.ObjectId(query.yearId);
    query.ulbId = query.ulbId ? new Types.ObjectId(query.ulbId) : undefined;
    const buffer = await this.afsDumpService.exportAfsExcelFiles(query);

    const filename = `afs-dump-${YearIdToLabel[query.yearId.toString()]}-${query.docType}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    return res.send(buffer);
  }

  @Get('with-afs')
  async getWithAfs(@Query() query: DigitizationReportQueryDto) {
    query.yearId = new Types.ObjectId(query.yearId);
    query.ulbId = query.ulbId ? new Types.ObjectId(query.ulbId) : undefined;
    return await this.afsDumpService.getAnnualWithAfsExcel(query);
  }
}
