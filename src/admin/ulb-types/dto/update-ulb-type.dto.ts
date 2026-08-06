import { PartialType } from '@nestjs/swagger';
import { CreateUlbTypeDto } from './create-ulb-type.dto';

export class UpdateUlbTypeDto extends PartialType(CreateUlbTypeDto) {}
