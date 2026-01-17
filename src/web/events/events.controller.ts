import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards } from '@nestjs/common';
import { EventsService } from './events.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { FindEventDto } from './dto/find-event-dto';
import { Types } from 'mongoose';
import { RolesGuard } from 'src/module/auth/guards/roles.guard';
import { Roles } from 'src/module/auth/decorators/roles.decorator';
import { Role } from 'src/module/auth/enum/role.enum';
import { CurrentUser } from 'src/module/auth/decorators/current-user.decorator';

@Controller('events')
@UseGuards(RolesGuard)
@Roles([Role.ADMIN])
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Post()
  create(@Body() createEventDto: CreateEventDto, @CurrentUser() user: any) {
    return this.eventsService.create(createEventDto, user);
  }

  @Get()
  find(@Query() query: FindEventDto) {
    return this.eventsService.find(query);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateEventDto: UpdateEventDto) {
    return this.eventsService.update(+id, updateEventDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.eventsService.deactivate(id);
  }
}
