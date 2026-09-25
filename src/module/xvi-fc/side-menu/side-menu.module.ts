import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SideMenu, SideMenuSchema } from '../../../schemas/side-menu.schema';
import { SideMenuService } from './side-menu.service';
import { SideMenuController } from './side-menu.controller';

@Module({
  imports: [MongooseModule.forFeature([{ name: SideMenu.name, schema: SideMenuSchema }])],
  controllers: [SideMenuController],
  providers: [SideMenuService],
  exports: [SideMenuService],
})
export class SideMenuModule {}
