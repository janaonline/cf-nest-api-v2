import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';
import { NamespacedCacheService } from './namespaced-cache.service';

@Global()
@Module({
  providers: [RedisService, NamespacedCacheService],
  exports: [RedisService, NamespacedCacheService],
})
export class RedisModule {}
