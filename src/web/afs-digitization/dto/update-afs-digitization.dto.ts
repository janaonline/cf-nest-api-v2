import { PartialType } from '@nestjs/mapped-types';
import { CreateAfsDigitizationDto } from './create-afs-digitization.dto';

export class UpdateAfsDigitizationDto extends PartialType(CreateAfsDigitizationDto) {}
