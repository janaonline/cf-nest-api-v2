import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { XviFcSideMenu, XviFcSideMenuSchema } from '../../../schemas/xvi-fc/xvi-fc-side-menu.schema';
import { SideMenuService } from './side-menu.service';
import { SideMenuController } from './side-menu.controller';
import { XviFcCacheService } from '../cache/xvi-fc-cache.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: XviFcSideMenu.name, schema: XviFcSideMenuSchema },
    ]),
  ],
  controllers: [SideMenuController],
  providers: [SideMenuService, XviFcCacheService],
})
export class SideMenuModule {}
