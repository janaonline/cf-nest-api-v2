import { PartialType } from '@nestjs/swagger';
import { CreateFormJsonDto } from './create-form-json.dto';

export class UpdateFormJsonDto extends PartialType(CreateFormJsonDto) {}
