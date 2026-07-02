import { Module } from '@nestjs/common';
import { UlbService } from './ulb.service';
import { UlbController } from './ulb.controller';

@Module({
  controllers: [UlbController],
  providers: [UlbService],
})
export class UlbModule {}
