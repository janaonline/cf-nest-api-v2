import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ApiClientsModule } from 'src/module/api-clients/api-client.module';
import { AuthModule } from 'src/module/auth/auth.module';
import { IntegrationJwtGuard } from 'src/module/auth/guards/integration-jwt.guard';
import { ScopesGuard } from 'src/module/auth/guards/scopes.guard';
import { Ulb, UlbSchema } from 'src/schemas/ulb.schema';
import { Year, YearSchema } from 'src/schemas/year.schema';
import { IntegrationAuthController } from './auth/integration-auth.controller';
import { IntegrationAuthService } from './auth/integration-auth.service';
import { DataCollectionController } from './data-collection.controller';
import { DataCollection, DataCollectionSchema } from './entities/data-collection.schema';
import { DataCollectionAuthorizationService } from './services/data-collection-authorization.service';
import { DataCollectionService } from './services/data-collection.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DataCollection.name, schema: DataCollectionSchema },
      { name: Ulb.name, schema: UlbSchema },
      { name: Year.name, schema: YearSchema },
    ]),
    ApiClientsModule,
    AuthModule,
  ],
  controllers: [DataCollectionController, IntegrationAuthController],
  providers: [
    DataCollectionService,
    IntegrationAuthService,
    IntegrationJwtGuard,
    ScopesGuard,
    DataCollectionAuthorizationService,
  ],
})
export class DataCollectionModule {}
