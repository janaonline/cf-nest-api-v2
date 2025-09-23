// src/schemas/data-collection-form.schema.ts

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

enum BodyTypeEnum {
  PARASTATAL = 'parastatal',
  ULB = 'ulb',
}

@Schema({ timestamps: { createdAt: 'createdAt', updatedAt: 'modifiedAt' } })
export class FileEntry {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  url: string;
}
export const FileEntrySchema = SchemaFactory.createForClass(FileEntry);

@Schema({ _id: false })
export class YearlyDocuments {
  @Prop({ type: [FileEntrySchema], default: [] })
  pdf: FileEntry[];

  @Prop({ type: [FileEntrySchema], default: [] })
  excel: FileEntry[];
}
export const YearlyDocumentsSchema =
  SchemaFactory.createForClass(YearlyDocuments);

@Schema({ timestamps: { createdAt: 'createdAt', updatedAt: 'modifiedAt' } })
export class DataCollectionForm {
  @Prop({ required: true, enum: BodyTypeEnum, index: true })
  bodyType: BodyTypeEnum;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Ulb', default: null })
  ulb: MongooseSchema.Types.ObjectId | null;

  @Prop({ default: null })
  parastatalName: string;

  @Prop({ default: null })
  person: string;

  @Prop({ default: null })
  designation: string;

  @Prop({ default: null })
  email: string;

  @Prop({
    type: {
      financial_year_2015_16: { type: YearlyDocumentsSchema, default: null },
      financial_year_2016_17: { type: YearlyDocumentsSchema, default: null },
      financial_year_2017_18: { type: YearlyDocumentsSchema, default: null },
      financial_year_2018_19: { type: YearlyDocumentsSchema, default: null },
      financial_year_2019_20: { type: YearlyDocumentsSchema, default: null },
      financial_year_2020_21: { type: YearlyDocumentsSchema, default: null },
    },
    default: {},
  })
  documents: {
    financial_year_2015_16?: YearlyDocuments | null;
    financial_year_2016_17?: YearlyDocuments | null;
    financial_year_2017_18?: YearlyDocuments | null;
    financial_year_2018_19?: YearlyDocuments | null;
    financial_year_2019_20?: YearlyDocuments | null;
    financial_year_2020_21?: YearlyDocuments | null;
  };

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'State', required: true })
  state: MongooseSchema.Types.ObjectId;

  @Prop()
  createdAt: Date;

  @Prop()
  modifiedAt: Date;
}

export type DataCollectionFormDocument = DataCollectionForm & Document;
export const DataCollectionFormSchema =
  SchemaFactory.createForClass(DataCollectionForm);
