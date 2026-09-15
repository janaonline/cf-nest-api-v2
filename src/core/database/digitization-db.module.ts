import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

/**
 * MONGO_URI points at a single MongoDB server/cluster hosting both the primary
 * app database (MONGO_DB_NAME) and the digitization database (DIGITIZATION_DB_NAME).
 * Rather than opening a second physical connection (as a second
 * `MongooseModule.forRootAsync` would), this reuses the primary connection's
 * socket/pool via `connection.useDb()`.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: getConnectionToken('digitization_db'),
      inject: [getConnectionToken(), ConfigService],
      useFactory: (connection: Connection, configService: ConfigService) => {
        const dbName = configService.get<string>('DIGITIZATION_DB_NAME');
        if (!dbName) throw new Error('DIGITIZATION_DB_NAME missing');
        return connection.useDb(dbName, { useCache: true });
      },
    },
  ],
  exports: [getConnectionToken('digitization_db')],
})
export class DigitizationDbModule {}
