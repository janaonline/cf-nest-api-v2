import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FormJson, FormJsonSchema } from '../../schemas/form-json.schema';
import { FormJsonService } from './form-json.service';
import { FormJsonController } from './form-json.controller';

@Module({
  imports: [MongooseModule.forFeature([{ name: FormJson.name, schema: FormJsonSchema }])],
  controllers: [FormJsonController],
  providers: [FormJsonService],
  exports: [FormJsonService, MongooseModule],
})
export class FormJsonModule {}
