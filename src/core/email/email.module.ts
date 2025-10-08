import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EmailList, EmailListSchema } from 'src/schemas/email-list';
import { EmailController } from './email.controller';
import { EmailService } from './email.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: EmailList.name, schema: EmailListSchema }])],
  controllers: [EmailController],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
