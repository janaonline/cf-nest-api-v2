import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { QueryUlbDto } from './query-ulb.dto';

// Query strings always arrive as strings — plainToInstance is what NestJS's global
// ValidationPipe ({ transform: true }) applies before validation runs.
const build = (query: Record<string, unknown>) => plainToInstance(QueryUlbDto, query);

describe('QueryUlbDto', () => {
  describe('isActive', () => {
    it('transforms the string "false" to boolean false', () => {
      // Regression: class-transformer's @Type(() => Boolean) previously coerced this via the
      // Boolean() constructor, where Boolean('false') === true, silently flipping the filter.
      expect(build({ isActive: 'false' }).isActive).toBe(false);
    });

    it('transforms the string "true" to boolean true', () => {
      expect(build({ isActive: 'true' }).isActive).toBe(true);
    });

    it('leaves isActive undefined when not provided', () => {
      expect(build({}).isActive).toBeUndefined();
    });
  });
});
