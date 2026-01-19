import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from 'src/module/auth/auth.module';
import { Events, EventSchema } from 'src/schemas/events.schema';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

@Module({
  imports: [AuthModule, MongooseModule.forFeature([{ name: Events.name, schema: EventSchema }])],
  controllers: [EventsController],
  providers: [EventsService],
})
export class EventsModule {}
