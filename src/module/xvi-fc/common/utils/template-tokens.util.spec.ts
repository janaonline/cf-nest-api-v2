import { interpolateTemplateTokens } from './template-tokens.util';

describe('interpolateTemplateTokens', () => {
  it('substitutes a known token', () => {
    expect(
      interpolateTemplateTokens('Submit your {{priorFcCycleLabel}} disclosures', {
        priorFcCycleLabel: '14th FC',
      }),
    ).toBe('Submit your 14th FC disclosures');
  });

  it('is a no-op when the text has no placeholder', () => {
    expect(interpolateTemplateTokens('Plain text, no tokens here', { priorFcCycleLabel: '14th FC' })).toBe(
      'Plain text, no tokens here',
    );
  });

  it('leaves an unknown placeholder literally in place', () => {
    expect(interpolateTemplateTokens('Value: {{unknownToken}}', { priorFcCycleLabel: '14th FC' })).toBe(
      'Value: {{unknownToken}}',
    );
  });

  it('substitutes every occurrence when the same token appears more than once', () => {
    expect(
      interpolateTemplateTokens('{{priorFcCycleLabel}} then {{priorFcCycleLabel}} again', {
        priorFcCycleLabel: '15th FC',
      }),
    ).toBe('15th FC then 15th FC again');
  });

  it('passes undefined input through unchanged', () => {
    expect(interpolateTemplateTokens(undefined, { priorFcCycleLabel: '14th FC' })).toBeUndefined();
  });

  it('passes an empty string through unchanged', () => {
    expect(interpolateTemplateTokens('', { priorFcCycleLabel: '14th FC' })).toBe('');
  });
});
