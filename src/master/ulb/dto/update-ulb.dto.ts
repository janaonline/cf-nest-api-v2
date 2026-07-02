import { PartialType } from '@nestjs/mapped-types';
import { CreateUlbDto } from './create-ulb.dto';

export class UpdateUlbDto extends PartialType(CreateUlbDto) {}
