import { Module } from '@nestjs/common';
import { SlbService } from './slb.service';
import { SlbController } from './slb.controller';

@Module({
  controllers: [SlbController],
  providers: [SlbService],
})
export class SlbModule {}
