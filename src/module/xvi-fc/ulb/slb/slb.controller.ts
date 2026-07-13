import { Controller } from '@nestjs/common';
import { SlbService } from './slb.service';

@Controller('slb')
export class SlbController {
  constructor(private readonly slbService: SlbService) {}
}
