import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EmailQueueModule } from 'src/core/queue/email-queue/email-queue.module';
import { User, UserSchema } from 'src/schemas/user/user.schema';
import { EmailTemplate, EmailTemplateSchema } from 'src/schemas/email-template.schema';
import { EmailReminder, EmailReminderSchema } from 'src/schemas/email-reminder.schema';
import { EmailRemindersController } from './email-reminders.controller';
import { EmailRemindersService } from './email-reminders.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: EmailReminder.name, schema: EmailReminderSchema },
      { name: EmailTemplate.name, schema: EmailTemplateSchema },
      { name: User.name, schema: UserSchema },
    ]),
    EmailQueueModule,
  ],
  controllers: [EmailRemindersController],
  providers: [EmailRemindersService],
  exports: [EmailRemindersService],
})
export class EmailRemindersModule {}
