import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FormWorkflowPermissions } from '../common/services/form-workflow.permissions';
import { CommunicationModule } from '../communication/communication.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { FormsController } from './forms.controller';
import { FormJson, FormJsonSchema } from './schemas/form-json.schema';
import { FormStatusHistory, FormStatusHistorySchema } from './schemas/form-status-history.schema';
import { FormSubmission, FormSubmissionSchema } from './schemas/form-submission.schema';
import { FormSubmissionStatusService } from './services/form-submission-status.service';
import { FormSubmissionSyncService } from './services/form-submission-sync.service';
import { FormSubmissionsService } from './services/form-submissions.service';
import { FormWorkflowService } from './services/form-workflow.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FormSubmission.name, schema: FormSubmissionSchema },
      { name: FormStatusHistory.name, schema: FormStatusHistorySchema },
      { name: FormJson.name, schema: FormJsonSchema },
    ]),
    CommunicationModule,
    NotificationsModule,
  ],
  controllers: [FormsController],
  providers: [
    FormWorkflowService,
    FormSubmissionStatusService,
    FormSubmissionsService,
    FormSubmissionSyncService,
    FormWorkflowPermissions,
  ],
  exports: [FormSubmissionsService, FormSubmissionStatusService, FormSubmissionSyncService],
})
export class FormsModule {}
