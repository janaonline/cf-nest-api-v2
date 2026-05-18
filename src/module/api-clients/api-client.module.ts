import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from 'src/module/auth/auth.module';
import { State, StateSchema } from 'src/schemas/state.schema';
import { Ulb, UlbSchema } from 'src/schemas/ulb.schema';
import { ApiClientAuditLog, ApiClientAuditLogSchema } from './entities/api-client-audit-log.schema';
import { ApiClientAuditLogService } from './services/api-client-audit-log.service';
import { ApiClient, ApiClientSchema } from './entities/api-client.schema';
import { ApiClientService } from './services/api-client.service';
import { ApiClientsController } from './api-clients.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ApiClient.name, schema: ApiClientSchema },
      { name: ApiClientAuditLog.name, schema: ApiClientAuditLogSchema },
      { name: State.name, schema: StateSchema },
      { name: Ulb.name, schema: UlbSchema },
    ]),
    AuthModule,
  ],
  controllers: [ApiClientsController],
  providers: [ApiClientService, ApiClientAuditLogService],
  exports: [ApiClientService, ApiClientAuditLogService],
})
export class ApiClientsModule {}
