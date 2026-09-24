import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateFormJsonConfigDto } from './create-form-json-config.dto';

/** formId is immutable after creation - identity of the document, not editable via PATCH. */
export class UpdateFormJsonConfigDto extends PartialType(OmitType(CreateFormJsonConfigDto, ['formId'] as const)) {}
