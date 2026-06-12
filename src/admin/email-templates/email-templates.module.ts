import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EmailQueueModule } from 'src/core/queue/email-queue/email-queue.module';
import { User, UserSchema } from 'src/schemas/user/user.schema';
import { EmailTemplate, EmailTemplateSchema } from 'src/schemas/email-template.schema';
import { EmailTemplatesController } from './email-templates.controller';
import { EmailTemplatesService } from './email-templates.service';
import { WeeklyReportService } from './weekly-report.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: EmailTemplate.name, schema: EmailTemplateSchema },
      { name: User.name, schema: UserSchema },
    ]),
    EmailQueueModule,
  ],
  controllers: [EmailTemplatesController],
  providers: [EmailTemplatesService, WeeklyReportService],
  exports: [EmailTemplatesService, WeeklyReportService],
})
export class EmailTemplatesModule {}
