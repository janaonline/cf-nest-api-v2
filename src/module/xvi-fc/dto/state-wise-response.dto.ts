export class StateYearTableRowDto {
  year: string;
  // Whole Rupees only — defensively rounded in XviFcService.getStateWiseData (GrantAllocation is
  // externally written and unconstrained).
  basic: number;
  performance: number;
}

export class StateWiseResponseDto {
  stateId: string;
  stateName: string;
  // Sum of the (already-rounded) tableData rows — see StateYearTableRowDto.
  totalAllocation: number;
  totalUlbs: number;
  years: string;
  tableData: StateYearTableRowDto[];
}