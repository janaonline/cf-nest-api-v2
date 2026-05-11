import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CommunicationPermissions } from '../common/services/communication.permissions';
import { CommunicationController } from './communication.controller';
import { MessageThread, MessageThreadSchema } from './schemas/message-thread.schema';
import { Message, MessageSchema } from './schemas/message.schema';
import { ThreadParticipant, ThreadParticipantSchema } from './schemas/thread-participant.schema';
import { ThreadReadState, ThreadReadStateSchema } from './schemas/thread-read-state.schema';
import { MessageThreadService } from './services/message-thread.service';
import { MessageService } from './services/message.service';
import { ThreadParticipantService } from './services/thread-participant.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MessageThread.name, schema: MessageThreadSchema },
      { name: Message.name, schema: MessageSchema },
      { name: ThreadParticipant.name, schema: ThreadParticipantSchema },
      { name: ThreadReadState.name, schema: ThreadReadStateSchema },
    ]),
  ],
  controllers: [CommunicationController],
  providers: [MessageThreadService, MessageService, ThreadParticipantService, CommunicationPermissions],
  exports: [MessageThreadService, MessageService, ThreadParticipantService],
})
export class CommunicationModule {}
