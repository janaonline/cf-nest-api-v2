/* eslint-disable prettier/prettier */
import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards, Req } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateProfileContactsDto } from './dto/update-profile-contacts.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { CreateManagedUserDto } from './dto/create-managed-user.dto';
import { CurrentUser } from 'src/module/auth/decorators/current-user.decorator';
import { PermissionGuard } from 'src/module/auth/permission.guard';
import { JwtAuthGuard } from 'src/module/auth/guards/jwt-auth.guard';
import { RequirePermissions } from 'src/module/auth/require-permissions.decorator';
import { Permission } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { AuthUser } from 'src/module/auth/auth-user.interface';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @ApiBearerAuth()
  @Post('create-user')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermissions(Permission.CREATE_MANAGED_USER)
  createManagedUser(@Body() dto: CreateManagedUserDto, @Req() req: Request & { user: AuthUser }) {
    console.log('Logged-in user from JWT:', req.user);
    return this.usersService.createManagedUser(dto, req.user);
  }

  @ApiBearerAuth()
  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @ApiBearerAuth()
  @Get('list')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermissions(Permission.VIEW_DATA)
  listUsers(@Query() query: ListUsersQueryDto) {
    return this.usersService.listUsers(query);
  }

  @ApiBearerAuth()
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @ApiBearerAuth()
  @Get('contacts/:id')
  findUserContacts(@Param('id') id: string) {
    return this.usersService.findUserContacts(id);
  }

  @ApiBearerAuth()
  @Patch('update-profile-contacts')
  updateProfileContacts(@CurrentUser() user: { _id: string }, @Body() dto: UpdateProfileContactsDto) {
    return this.usersService.updateProfileContacts(user._id, dto);
  }

  @ApiBearerAuth()
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(id, updateUserDto);
  }

  @ApiBearerAuth()
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }
}
