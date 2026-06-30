import { ApiProperty } from '@nestjs/swagger';

export class StateMemberResponseDto {
  @ApiProperty()
  _id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  mobile!: string;

  @ApiProperty({ required: false })
  email?: string;

  @ApiProperty()
  designation!: string;

  @ApiProperty({ enum: ['SUBMITTER', 'EDITOR', 'VIEWER'] })
  subRole!: 'SUBMITTER' | 'EDITOR' | 'VIEWER';

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({ type: String, nullable: true })
  lastActive!: string | null;
}
