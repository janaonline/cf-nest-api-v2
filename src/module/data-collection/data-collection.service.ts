import { ConflictException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import { Year, YearDocument } from 'src/schemas/year.schema';
import { CreateDataCollectionDto } from './dto/create-data-collection.dto';
import { UpdateDataCollectionDto } from './dto/update-data-collection.dto';
import { DataCollection, DataCollectionDocument } from './entities/data-collection.schema';

@Injectable()
export class DataCollectionService {
  private logger = new Logger(DataCollectionService.name);

  constructor(
    @InjectModel(DataCollection.name)
    private readonly dataCollectionModel: Model<DataCollectionDocument>,

    @InjectModel(Ulb.name)
    private readonly ulbModel: Model<UlbDocument>,

    @InjectModel(Year.name)
    private readonly yearModel: Model<YearDocument>,
  ) {}

  getFinancialDataTemplate() {
    return `This action returns financial data template`;
  }

  getUlbsList() {
    return `This action returns list of ulbs from the state`;
  }

  getYearsList() {
    return `This action returns list of years`;
  }

  async create(payload: CreateDataCollectionDto) {
    try {
      const data = await this.dataCollectionModel
        .findOne({
          ulbId: new Types.ObjectId(payload.ulbId),
          yearId: new Types.ObjectId(payload.yearId),
        })
        .lean<DataCollectionDocument>();

      if (data) {
        throw new ConflictException(
          `Data for ${payload.ulbId} and ${payload.yearId} already exists. Try using PUT method.`,
        );
      }

      // const validateData = validatePayloadData(payload.lineItems);
      // if (!validateData.success) {
      // } else {
      //   const created = new this.dataCollectionModel(data);
      //   return created.save();
      // }
    } catch (error) {
      this.logger.error('Failed to create entry in DataCollection model.', error);
      throw new InternalServerErrorException('Something went wrong while creating DataCollection');
    }
  }

  update(updateDataCollectionDto: UpdateDataCollectionDto) {
    return { message: `This action updates existing dataCollection`, updateDataCollectionDto };
  }

  // private validatePayloadData(data) {}
}
