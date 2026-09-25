import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Ulb, UlbSchema } from 'src/schemas/ulb.schema';
import { UlbType, UlbTypeSchema } from 'src/schemas/ulb-type.schema';
import { UlbEligibilityService } from './ulb-eligibility.service';

/**
 * Small, dependency-light leaf module (only the `Ulb`/`UlbType` schemas + the global cache) so it
 * can be imported from `AuthModule` and any xvi-fc feature module without circular-import risk —
 * mirrors how those modules already each register `MongooseModule.forFeature([{name: Ulb.name}])`
 * locally rather than sharing one giant "master data" module.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Ulb.name, schema: UlbSchema },
      { name: UlbType.name, schema: UlbTypeSchema },
    ]),
  ],
  providers: [UlbEligibilityService],
  exports: [UlbEligibilityService],
})
export class UlbEligibilityModule {}
