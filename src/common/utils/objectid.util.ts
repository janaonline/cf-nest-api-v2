import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';

/**
 * Normalises any ObjectId-like value — ObjectId instance, plain hex string,
 * or a populated sub-document { _id: ObjectId } — into a hex string.
 * Returns null when the value is absent or unrecognised.
 */
export function toObjectIdString(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Types.ObjectId) return value.toString();
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && '_id' in (value as object)) {
    const id = (value as { _id?: unknown })._id;
    if (id instanceof Types.ObjectId) return id.toString();
    if (typeof id === 'string') return id;
  }
  return null;
}

/**
 * Converts a string or existing ObjectId to Types.ObjectId with format validation.
 * @param value Input to convert.
 * @param fieldName Field name used in the error message.
 * @returns Validated Types.ObjectId instance.
 * @throws BadRequestException if the value is missing or not a valid ObjectId string.
 */
export function toObjectId(value: string | Types.ObjectId | undefined | null, fieldName = 'id'): Types.ObjectId {
  if (value instanceof Types.ObjectId) return value;
  if (!value || typeof value !== 'string' || !Types.ObjectId.isValid(value)) {
    throw new BadRequestException(`Invalid ${fieldName}`);
  }
  return new Types.ObjectId(value);
}

/**
 * Safely compares two ObjectId-like values by converting both to string.
 * Returns false if either value is null/undefined.
 * @param left First value.
 * @param right Second value.
 * @returns True when both are non-null and their string forms match.
 */
export function objectIdEquals(left?: string | Types.ObjectId | null, right?: string | Types.ObjectId | null): boolean {
  if (!left || !right) return false;
  return String(left) === String(right);
}

/**
 * Converts an ObjectId-like value to its string representation, or undefined if absent.
 * @param value Value to convert.
 * @returns Hex string or undefined.
 */
export function objectIdToString(value?: string | Types.ObjectId | null): string | undefined {
  return value ? String(value) : undefined;
}
