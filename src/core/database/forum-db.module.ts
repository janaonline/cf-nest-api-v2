import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

/** Name of the Mongoose connection (and `forFeature` connection name) for the forum database. */
export const FORUM_DB_CONNECTION = 'forum_db';

/**
 * The forum keeps its data in its own database (FORUM_DB_NAME, default `forum_db`) on the same server as the
 * primary database, reusing the primary connection's socket/pool via `connection.useDb()` (same approach as
 * DigitizationDbModule). Users still come from the primary database.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: getConnectionToken(FORUM_DB_CONNECTION),
      inject: [getConnectionToken(), ConfigService],
      useFactory: (connection: Connection, configService: ConfigService) =>
        connection.useDb(configService.get<string>('FORUM_DB_NAME') || 'forum_db', { useCache: true }),
    },
  ],
  exports: [getConnectionToken(FORUM_DB_CONNECTION)],
})
export class ForumDbModule {}
