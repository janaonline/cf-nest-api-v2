import { Global, Module } from '@nestjs/common';
import { FileTokenService } from './file-token.service';

@Global()
@Module({
  providers: [FileTokenService],
  exports: [FileTokenService],
})
export class FileTokenModule {}
