import { ArgumentMetadata, BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { Types } from 'mongoose';

/**
 * Validates that a route/query parameter is a valid MongoDB ObjectId format.
 * Returns the original string — services convert to Types.ObjectId internally.
 * The 400 error message includes the parameter name (e.g. "Invalid notificationId").
 */
@Injectable()
export class ParseObjectIdPipe implements PipeTransform<string, string> {
  transform(value: string, metadata: ArgumentMetadata): string {
    if (!Types.ObjectId.isValid(value)) {
      const fieldName = metadata.data ?? 'id';
      throw new BadRequestException(`Invalid ${fieldName}`);
    }
    return value;
  }
}
