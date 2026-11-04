import { Injectable } from '@nestjs/common';
import { escapeRegex } from 'src/common/utils/regex.util';
import { ExpectedUlbSetService } from './expected-ulb-set.service';

export interface XviFcUlbOption {
  ulbId: string;
  name: string;
  censusCode: string | null;
  sbCode: string | null;
}

const DEFAULT_LIMIT = 10;

/**
 * Generic "pick a ULB" source for any 16th-FC feature whose dropdown needs nothing beyond the
 * plain eligible list (unlike Claim Letter/FC Unspent Declaration's own ULB-options services,
 * which attach real feature-specific business logic per ULB and so own their own endpoint).
 */
@Injectable()
export class XviFcUlbOptionsService {
  constructor(private readonly expectedUlbSetService: ExpectedUlbSetService) {}

  async getOptions(stateId: string, yearId: string, search?: string, limit?: number): Promise<XviFcUlbOption[]> {
    const expectedUlbs = await this.expectedUlbSetService.resolve(stateId, yearId);

    let options = expectedUlbs;
    if (search?.trim()) {
      const regex = new RegExp(escapeRegex(search.trim()), 'i');
      options = options.filter(
        (u) => regex.test(u.name) || (u.censusCode && regex.test(u.censusCode)) || (u.sbCode && regex.test(u.sbCode)),
      );
    }

    // Matches FcUnspentUlbOptionsService's {name: 1, _id: 1} sort convention - resolve() itself stays
    // unsorted since other callers (e.g. idsByState) don't care about order.
    const sorted = [...options].sort((a, b) => a.name.localeCompare(b.name) || a.ulbId.localeCompare(b.ulbId));

    return sorted.slice(0, limit ?? DEFAULT_LIMIT);
  }
}
