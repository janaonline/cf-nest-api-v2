import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SideMenu, SideMenuSchema } from '../../../schemas/side-menu.schema';
import { SideMenuService } from './side-menu.service';
import { SideMenuController } from './side-menu.controller';
import { XviFcCacheService } from '../cache/xvi-fc-cache.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: SideMenu.name, schema: SideMenuSchema }])],
  controllers: [SideMenuController],
  providers: [SideMenuService, XviFcCacheService],
})
export class SideMenuModule {}
