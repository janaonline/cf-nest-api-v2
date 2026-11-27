import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsMongoId,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateBy,
  ValidateIf,
  type ValidationOptions,
} from 'class-validator';
import { FORUM_REPORT_REASONS, type ForumReportReason } from '../../../schemas/forum/forum-report.schema';
import { FORUM_CATEGORY_SLUG_PATTERN, FORUM_LIMITS } from '../forum.constants';

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);

/**
 * String length in UTF-16 code units (`value.length`), the measure Mongoose's `maxlength` uses.
 * class-validator's `@Length` counts an emoji as 1, so a value it accepts could still be refused by
 * the schema on save; this keeps the DTO and the schema on the same boundary.
 */
function Utf16Length(min: number, max: number, options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'utf16Length',
      constraints: [min, max],
      validator: {
        validate: (value: unknown) => typeof value === 'string' && value.length >= min && value.length <= max,
      },
    },
    options,
  );
}

/**
 * Like `@IsOptional()`, but only an omitted field skips validation. `@IsOptional()` also skips
 * `null`, which would let `{ "title": null }` through to the update and store a null title.
 */
const IsOptionalNotNull = (): PropertyDecorator =>
  ValidateIf((_object: unknown, value: unknown) => value !== undefined);

const { title, threadBody, commentBody } = FORUM_LIMITS;

export class ListThreadsQueryDto {
  @ApiPropertyOptional({ description: 'Category slug filter' })
  @IsOptional()
  @IsString()
  @Transform(trim)
  category?: string;

  @ApiPropertyOptional({ description: 'Free-text search over title, body, author, category and replies' })
  @IsOptional()
  @IsString()
  @Transform(trim)
  q?: string;
}

const TITLE_MESSAGE = 'Title must be 5–140 characters.';
const BODY_MESSAGE = 'Body must be 20–20,000 characters.';
const CATEGORY_MESSAGE = 'Choose a valid category.';

export class CreateThreadDto {
  @ApiProperty({ minLength: title.min, maxLength: title.max })
  @Transform(trim)
  @IsString({ message: TITLE_MESSAGE })
  @Utf16Length(title.min, title.max, { message: TITLE_MESSAGE })
  title!: string;

  @ApiProperty({ minLength: threadBody.min, maxLength: threadBody.max })
  @Transform(trim)
  @IsString({ message: BODY_MESSAGE })
  @Utf16Length(threadBody.min, threadBody.max, { message: BODY_MESSAGE })
  body!: string;

  @ApiProperty({ example: 'ulb-queries' })
  @Transform(trim)
  @IsString()
  @Matches(FORUM_CATEGORY_SLUG_PATTERN, { message: CATEGORY_MESSAGE })
  categorySlug!: string;
}

/** Every field may be omitted (the stored value is kept); a field that is sent must be valid, never null. */
export class UpdateThreadDto {
  @ApiPropertyOptional()
  @IsOptionalNotNull()
  @Transform(trim)
  @IsString({ message: TITLE_MESSAGE })
  @Utf16Length(title.min, title.max, { message: TITLE_MESSAGE })
  title?: string;

  @ApiPropertyOptional()
  @IsOptionalNotNull()
  @Transform(trim)
  @IsString({ message: BODY_MESSAGE })
  @Utf16Length(threadBody.min, threadBody.max, { message: BODY_MESSAGE })
  body?: string;

  @ApiPropertyOptional()
  @IsOptionalNotNull()
  @Transform(trim)
  @IsString({ message: CATEGORY_MESSAGE })
  @Matches(FORUM_CATEGORY_SLUG_PATTERN, { message: CATEGORY_MESSAGE })
  categorySlug?: string;
}

export class CreateCommentDto {
  @ApiProperty({ minLength: commentBody.min, maxLength: commentBody.max })
  @Transform(trim)
  @IsString()
  @Utf16Length(commentBody.min, commentBody.max, { message: 'Reply must be 2–10,000 characters.' })
  body!: string;

  @ApiPropertyOptional({ description: 'Parent comment id (replies nest to 3 levels)' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (value === '' ? undefined : value))
  @IsMongoId({ message: 'Choose a valid comment to reply to.' })
  parentId?: string;
}

export class ThreadReactionDto {
  @ApiProperty({ enum: ['like', 'bookmark'] })
  @IsIn(['like', 'bookmark'])
  reaction!: 'like' | 'bookmark';

  @ApiProperty()
  @IsBoolean()
  active!: boolean;
}

export class CommentLikeDto {
  @ApiProperty()
  @IsBoolean()
  active!: boolean;
}

export class ModerateThreadDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDeleted?: boolean;
}

export class ModerateCommentDto {
  @ApiProperty()
  @IsBoolean()
  isDeleted!: boolean;
}

export class ReportPostDto {
  @ApiProperty({ enum: FORUM_REPORT_REASONS })
  @IsIn(FORUM_REPORT_REASONS, { message: 'Choose a reason for the report.' })
  reason!: ForumReportReason;
}

export class ResolveReportDto {
  @ApiProperty({ enum: ['hide', 'dismiss'], description: 'hide = hide the reported post; dismiss = keep it' })
  @IsIn(['hide', 'dismiss'])
  action!: 'hide' | 'dismiss';
}

export class CategoryDto {
  @ApiProperty({ minLength: 2, maxLength: 60 })
  @Transform(trim)
  @IsString()
  @Length(2, 60)
  name!: string;

  @ApiPropertyOptional({ description: 'Defaults to a slug derived from the name' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  slug?: string;

  @ApiProperty({ minLength: 2, maxLength: 240 })
  @Transform(trim)
  @IsString()
  @Length(2, 240)
  description!: string;
}
