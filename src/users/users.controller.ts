import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateProfileContactsDto } from './dto/update-profile-contacts.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { ListTeamMembersQueryDto } from './dto/list-team-members-query.dto';
import { CreateManagedUserDto } from './dto/create-managed-user.dto';
import { UpdatePermissionOverridesDto } from './dto/update-permission-overrides.dto';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { TransferOwnershipDto } from './dto/transfer-ownership.dto';
import { CurrentUser } from 'src/module/auth/decorators/current-user.decorator';
import { PermissionGuard } from 'src/module/auth/permission.guard';
import { JwtAuthGuard } from 'src/module/auth/guards/jwt-auth.guard';
import { RequirePermissions } from 'src/module/auth/require-permissions.decorator';
import { Permission } from 'src/module/auth/enum/roles-xvi-fc.enum';
import type { AuthUser } from 'src/module/auth/auth-user.interface';

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
  createManagedUser(@Body() dto: CreateManagedUserDto, @CurrentUser() user: AuthUser) {
    return this.usersService.createManagedUser(dto, user);
  }

  @ApiBearerAuth()
  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  /**
   * Returns the role-permission matrix rows for the requesting user's scope.
   * For UI display only — not a security boundary.
   * Declared before :id to avoid route ambiguity.
   */
  @ApiBearerAuth()
  @Get('permission-matrix')
  @ApiOperation({ summary: 'Get permission matrix rows for the current user scope (ULB or STATE)' })
  getPermissionMatrix(@CurrentUser() user: AuthUser) {
    return this.usersService.getPermissionMatrix(user);
  }

  @ApiBearerAuth()
  @Get('list')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermissions(Permission.VIEW_MANAGED_USERS)
  listUsers(@Query() query: ListUsersQueryDto, @CurrentUser() user: AuthUser) {
    return this.usersService.listUsers(query, user);
  }

  @ApiBearerAuth()
  @Get('team-members')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermissions(Permission.VIEW_MANAGED_USERS)
  @ApiOperation({ summary: 'List real team members for a ULB or State — no legacy contacts' })
  listTeamMembers(@Query() query: ListTeamMembersQueryDto, @CurrentUser() user: AuthUser) {
    return this.usersService.listTeamMembers(query, user);
  }

  @ApiBearerAuth()
  @Get('contacts/:id')
  findUserContacts(@Param('id') id: string) {
    return this.usersService.findUserContacts(id);
  }

  @ApiBearerAuth()
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @ApiBearerAuth()
  @Patch(':id/profile-contacts')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.UPDATE_MANAGED_USER)
  @ApiOperation({ summary: 'Update profile contacts for a managed user in the same ULB/state' })
  updateProfileContacts(@Param('id') id: string, @Body() dto: UpdateProfileContactsDto, @CurrentUser() user: AuthUser) {
    return this.usersService.updateProfileContacts(id, dto, user);
  }

  /**
   * Set allow/deny permission overrides for a managed user.
   * Only ULB/STATE admin can call this. Target user must belong to the same ULB/state.
   */
  @ApiBearerAuth()
  @Patch(':id/permission-overrides')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermissions(Permission.MANAGE_USERS)
  @ApiOperation({ summary: 'Grant or revoke specific permissions for a managed user' })
  updatePermissionOverrides(
    @Param('id') id: string,
    @Body() dto: UpdatePermissionOverridesDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.usersService.updatePermissionOverrides(id, dto, user);
  }

  @ApiBearerAuth()
  @Post('transfer-ownership')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.MANAGE_USERS)
  @ApiOperation({ summary: 'Transfer ULB/STATE ownership to an editor or viewer in the same scope' })
  transferOwnership(@Body() dto: TransferOwnershipDto, @CurrentUser() user: AuthUser) {
    return this.usersService.transferOwnership(dto, user);
  }

  @ApiBearerAuth()
  @Post(':id/resend-invite')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermissions(Permission.MANAGE_USERS)
  @ApiOperation({ summary: 'Resend invite SMS to a pending managed user (max 3/hr)' })
  resendInvite(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.usersService.resendInvite(id, user);
  }

  @ApiBearerAuth()
  @Patch(':id/role')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.UPDATE_MANAGED_USER)
  @ApiOperation({ summary: 'Update role of a managed user in the same ULB/state' })
  updateUserRole(@Param('id') id: string, @Body() dto: UpdateUserRoleDto, @CurrentUser() user: AuthUser) {
    return this.usersService.updateUserRole(id, dto, user);
  }

  @ApiBearerAuth()
  @Delete(':id')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.DELETE_MANAGED_USER)
  @ApiOperation({ summary: 'Soft-delete a managed user in the same ULB/state' })
  softDeleteUser(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.usersService.softDeleteUser(id, user);
  }

  @ApiBearerAuth()
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(id, updateUserDto);
  }
}
