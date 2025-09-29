import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UnsubscribedUser, UnsubscribedUserSchema } from 'src/schemas/unsubscribed-users';
import { EmailController } from './email.controller';
import { EmailService } from './email.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: UnsubscribedUser.name, schema: UnsubscribedUserSchema }])],
  controllers: [EmailController],
  providers: [EmailService],
})
export class EmailModule {}
