import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { VisitSession, VisitSessionDocument } from 'src/schemas/visit-session.schema';

@Injectable()
export class VisitSessionService {
  constructor(
    @InjectModel(VisitSession.name)
    private readonly visitSessionModel: Model<VisitSessionDocument>,
  ) {}

  async startSession(): Promise<{ _id: Types.ObjectId }> {
    const session = await this.visitSessionModel.create({});
    return { _id: session._id };
  }

  async endSession(id: string): Promise<{ modified: number }> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Invalid session id');
    const result = await this.visitSessionModel.updateOne(
      { _id: new Types.ObjectId(id) },
      { $set: { isActive: false } },
    );
    if (result.matchedCount === 0) throw new NotFoundException('Session not found');
    return { modified: result.modifiedCount };
  }

  async visitCount(): Promise<number> {
    return this.visitSessionModel.countDocuments();
  }
}
