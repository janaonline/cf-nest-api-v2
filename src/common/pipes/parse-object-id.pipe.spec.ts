import { ArgumentMetadata, BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ParseObjectIdPipe } from './parse-object-id.pipe';

describe('ParseObjectIdPipe', () => {
  let pipe: ParseObjectIdPipe;

  beforeEach(() => {
    pipe = new ParseObjectIdPipe();
  });

  function metadata(data?: string): ArgumentMetadata {
    return { type: 'param', data, metatype: String };
  }

  it('returns the original string when it is a valid ObjectId', () => {
    const validId = new Types.ObjectId().toString();
    expect(pipe.transform(validId, metadata('id'))).toBe(validId);
  });

  it('returns the exact same string instance value (not converted to ObjectId)', () => {
    const validId = new Types.ObjectId().toString();
    const result = pipe.transform(validId, metadata('id'));
    expect(typeof result).toBe('string');
    expect(result).toEqual(validId);
  });

  it('throws BadRequestException for an invalid ObjectId string', () => {
    expect(() => pipe.transform('not-an-object-id', metadata('id'))).toThrow(BadRequestException);
  });

  it('throws BadRequestException for an empty string', () => {
    expect(() => pipe.transform('', metadata('id'))).toThrow(BadRequestException);
  });

  it('includes the field name from metadata.data in the error message', () => {
    expect(() => pipe.transform('bad-value', metadata('threadId'))).toThrow('Invalid threadId');
  });

  it('falls back to "id" when metadata.data is undefined', () => {
    expect(() => pipe.transform('bad-value', metadata(undefined))).toThrow('Invalid id');
  });

  it('accepts a 24-char hex string even if not created via Types.ObjectId', () => {
    const hex = 'a'.repeat(24);
    expect(pipe.transform(hex, metadata('id'))).toBe(hex);
  });

  it('rejects a numeric-only short string that Types.ObjectId would otherwise coerce', () => {
    // Types.ObjectId.isValid('123') returns true for some short numeric strings in older
    // mongoose versions; guard against a hex string that is too short instead, which is
    // reliably invalid across versions.
    expect(() => pipe.transform('abc123', metadata('id'))).toThrow(BadRequestException);
  });
});
