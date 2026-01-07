import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { descLen, issueKindEnum } from 'src/schemas/report-an-issue.schema';

export class ReportAnIssueDto {
  @ApiPropertyOptional({
    description: 'What kind of issues are you facing?',
    example: 'data_seems_wrong',
  })
  @IsNotEmpty()
  @IsIn(issueKindEnum)
  issueKind: string;

  @ApiPropertyOptional({
    description: 'Description',
    example: 'Captial expenditure number is incorrect.',
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(descLen.max)
  @MinLength(descLen.min)
  desc: string;

  @ApiPropertyOptional({
    description: 'Email Id',
    example: 'abc@gmail.com',
  })
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @ApiPropertyOptional({
    description: 'Include screenshot',
    example: 'http://url.com',
  })
  @IsOptional()
  @IsString()
  issueScreenshotUrl?: string;

  @ApiPropertyOptional({
    description: 'Auto captured context',
    example: '/municipal-data/city/bengaluru',
  })
  @IsString()
  @IsNotEmpty()
  autoCaptureContext: string;
}
