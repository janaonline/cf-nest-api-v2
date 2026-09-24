import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FormJsonConfig, FormJsonConfigSchema } from '../../schemas/form-json-config.schema';
import { FormJsonConfigService } from './form-json-config.service';
import { FormJsonConfigController } from './form-json-config.controller';

@Module({
  imports: [MongooseModule.forFeature([{ name: FormJsonConfig.name, schema: FormJsonConfigSchema }])],
  controllers: [FormJsonConfigController],
  providers: [FormJsonConfigService],
  exports: [FormJsonConfigService, MongooseModule],
})
export class FormJsonConfigModule {}
