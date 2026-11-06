import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsMongoId, IsOptional, IsString, Length, Matches } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);

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

export class CreateThreadDto {
  @ApiProperty({ minLength: 5, maxLength: 140 })
  @Transform(trim)
  @IsString()
  @Length(5, 140, { message: 'Title must be 5–140 characters.' })
  title!: string;

  @ApiProperty({ minLength: 20, maxLength: 20000 })
  @Transform(trim)
  @IsString()
  @Length(20, 20_000, { message: 'Body must be 20–20,000 characters.' })
  body!: string;

  @ApiProperty({ example: 'ulb-queries' })
  @Transform(trim)
  @IsString()
  @Matches(/^[a-z0-9-]{2,60}$/, { message: 'Choose a valid category.' })
  categorySlug!: string;
}

export class UpdateThreadDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(5, 140, { message: 'Title must be 5–140 characters.' })
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(20, 20_000, { message: 'Body must be 20–20,000 characters.' })
  body?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(/^[a-z0-9-]{2,60}$/, { message: 'Choose a valid category.' })
  categorySlug?: string;
}

export class CreateCommentDto {
  @ApiProperty({ minLength: 2, maxLength: 10000 })
  @Transform(trim)
  @IsString()
  @Length(2, 10_000, { message: 'Reply must be 2–10,000 characters.' })
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
