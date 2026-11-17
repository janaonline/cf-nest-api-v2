import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from 'src/module/users/users.module';
import { Adc, AdcSchema } from 'src/schemas/adc.schema';
import { State, StateSchema } from 'src/schemas/state.schema';
import { Ulb, UlbSchema } from 'src/schemas/ulb.schema';
import { User, UserSchema } from 'src/schemas/user/user.schema';
import { AdcController } from './adc.controller';
import { AdcService } from './adc.service';
import { AdcAuditLogModule } from './audit/adc-audit-log.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Adc.name, schema: AdcSchema },
      { name: Ulb.name, schema: UlbSchema },
      { name: User.name, schema: UserSchema },
      { name: State.name, schema: StateSchema },
    ]),
    UsersModule,
    AdcAuditLogModule,
  ],
  controllers: [AdcController],
  providers: [AdcService],
})
export class AdcModule {}
