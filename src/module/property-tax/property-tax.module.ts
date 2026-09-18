import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PropertyTaxOpMapper, PropertyTaxOpMapperSchema } from '../../schemas/property-tax-op-mapper.schema';
import { Year, YearSchema } from '../../schemas/year.schema';
import { PropertyTaxController } from './property-tax.controller';
import { PropertyTaxService } from './property-tax.service';

// Deliberately its own top-level module, not nested under xv-fc-review (which hasn't gone live
// yet) or xvi-fc — this feature (the ULB portal's "Property Tax* (Cr.)" trend chart) is
// independent of both and reads only from the pre-existing, external propertytaxopmappers
// collection.
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PropertyTaxOpMapper.name, schema: PropertyTaxOpMapperSchema },
      { name: Year.name, schema: YearSchema },
    ]),
  ],
  controllers: [PropertyTaxController],
  providers: [PropertyTaxService],
  exports: [PropertyTaxService],
})
export class PropertyTaxModule {}
