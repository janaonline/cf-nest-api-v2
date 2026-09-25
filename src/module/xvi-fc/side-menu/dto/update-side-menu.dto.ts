import { PartialType } from '@nestjs/swagger';
import { CreateSideMenuDto } from './create-side-menu.dto';

export class UpdateSideMenuDto extends PartialType(CreateSideMenuDto) {}
