import { computeColumnWidths } from './claim-letter-pdf-layout.helpers';

describe('computeColumnWidths', () => {
  it('splits the remaining width evenly across the trailing columns', () => {
    const result = computeColumnWidths(4, 515);

    expect(result.trailing).toHaveLength(4);
    expect(result.trailing.every((w) => w === result.trailing[0])).toBe(true);
  });

  it('every column width sums back to the requested contentWidth', () => {
    const contentWidth = 515;
    const result = computeColumnWidths(5, contentWidth);

    const total = result.slNo + result.ulb + result.trailing.reduce((sum, w) => sum + w, 0);
    expect(total).toBeCloseTo(contentWidth, 5);
  });

  it('scales down per-column width as the criteria count grows', () => {
    const fourColumns = computeColumnWidths(4, 515);
    const eightColumns = computeColumnWidths(8, 515);

    expect(eightColumns.trailing[0]).toBeCloseTo(fourColumns.trailing[0] / 2, 5);
  });

  it('folds all remaining width into the ULB column when there are no trailing columns', () => {
    const result = computeColumnWidths(0, 515);

    expect(result.trailing).toEqual([]);
    expect(result.slNo + result.ulb).toBeCloseTo(515, 5);
  });

  it('never returns a negative width even if contentWidth is smaller than the fixed columns', () => {
    const result = computeColumnWidths(3, 50);

    expect(result.trailing.every((w) => w >= 0)).toBe(true);
  });
});
