import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ApiClientsModule } from 'src/module/api-clients/api-client.module';
import { AuthModule } from 'src/module/auth/auth.module';
import { LineItemsLegendsModule } from 'src/module/line-items-legends/line-items-legends.module';
import { IntegrationJwtGuard } from 'src/module/auth/guards/integration-jwt.guard';
import { ScopesGuard } from 'src/module/auth/guards/scopes.guard';
import { State, StateSchema } from 'src/schemas/state.schema';
import { Ulb, UlbSchema } from 'src/schemas/ulb.schema';
import { Year, YearSchema } from 'src/schemas/year.schema';
import { IntegrationAuthController } from './auth/integration-auth.controller';
import { IntegrationAuthService } from './auth/integration-auth.service';
import { DataCollectionController } from './data-collection.controller';
import { DataCollection, DataCollectionSchema } from './entities/data-collection.schema';
import { DataCollectionAuthorizationService } from './services/data-collection-authorization.service';
import { DataCollectionReferenceResolverService } from './services/data-collection-reference-resolver.service';
import { DataCollectionService } from './services/data-collection.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DataCollection.name, schema: DataCollectionSchema },
      { name: Ulb.name, schema: UlbSchema },
      { name: Year.name, schema: YearSchema },
      { name: State.name, schema: StateSchema },
    ]),
    ApiClientsModule,
    AuthModule,
    LineItemsLegendsModule,
  ],
  controllers: [DataCollectionController, IntegrationAuthController],
  providers: [
    DataCollectionService,
    IntegrationAuthService,
    IntegrationJwtGuard,
    ScopesGuard,
    DataCollectionAuthorizationService,
    DataCollectionReferenceResolverService,
  ],
})
export class DataCollectionModule {}
