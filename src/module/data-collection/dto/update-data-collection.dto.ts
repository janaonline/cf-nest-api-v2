import { PartialType } from '@nestjs/mapped-types';
import { CreateDataCollectionDto } from './create-data-collection.dto';

export class UpdateDataCollectionDto extends PartialType(CreateDataCollectionDto) {}
