import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from 'src/schemas/user/user.schema';
import { Ulb, UlbSchema } from 'src/schemas/ulb.schema';
import { State, StateSchema } from 'src/schemas/state.schema';
import { EmailQueueModule } from 'src/core/queue/email-queue/email-queue.module';
import { UsersController } from './users.controller';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Ulb.name, schema: UlbSchema },
      { name: State.name, schema: StateSchema },
    ]),
    EmailQueueModule,
  ],
  controllers: [UsersController],
  providers: [UsersService, UsersRepository],
  exports: [UsersRepository],
})
export class UsersModule {}
