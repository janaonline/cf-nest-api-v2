import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdcAuditLog, AdcAuditLogSchema } from 'src/schemas/adc-audit-log.schema';
import { AdcAuditLogService } from './adc-audit-log.service';

/** Its own module so AdcModule, UsersModule and UlbModule can all log without importing each other. */
@Module({
  imports: [MongooseModule.forFeature([{ name: AdcAuditLog.name, schema: AdcAuditLogSchema }])],
  providers: [AdcAuditLogService],
  exports: [AdcAuditLogService],
})
export class AdcAuditLogModule {}
