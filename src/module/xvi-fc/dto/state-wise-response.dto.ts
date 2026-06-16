export class StateYearTableRowDto {
  year: string;
  basic: number;
  performance: number;
}

export class StateWiseResponseDto {
  stateId: string;
  stateName: string;
  totalAllocation: number;
  totalUlbs: number;
  years: string;
  tableData: StateYearTableRowDto[];
}