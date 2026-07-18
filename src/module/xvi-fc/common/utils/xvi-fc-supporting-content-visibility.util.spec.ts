import type { FieldSupportingContent } from '../types/field-config.type';
import { applyActionVisibility } from './xvi-fc-supporting-content-visibility.util';

function actionsBlock(overrides: Partial<FieldSupportingContent> = {}): FieldSupportingContent {
  return {
    type: 'actions',
    position: 'before',
    description: 'Download the official template and upload the signed declaration.',
    actions: [{ id: 'download-template', label: 'Download the official template', visible: true }],
    ...overrides,
  };
}

describe('applyActionVisibility', () => {
  it('returns undefined unchanged when supportingContent is undefined', () => {
    expect(applyActionVisibility(undefined, { 'download-template': false })).toBeUndefined();
  });

  it('sets the named action visible=false and clears the block description when it is the only action', () => {
    const result = applyActionVisibility([actionsBlock()], { 'download-template': false })!;
    expect(result[0].actions![0].visible).toBe(false);
    expect(result[0].description).toBeUndefined();
  });

  it('keeps the description when the toggled action is still visible', () => {
    const result = applyActionVisibility([actionsBlock()], { 'download-template': true })!;
    expect(result[0].actions![0].visible).toBe(true);
    expect(result[0].description).toBe('Download the official template and upload the signed declaration.');
  });

  it('keeps the description when a second, untouched action in the block remains visible', () => {
    const block = actionsBlock({
      actions: [
        { id: 'download-template', label: 'Download the official template', visible: true },
        { id: 'view-history', label: 'View history', visible: true },
      ],
    });
    const result = applyActionVisibility([block], { 'download-template': false })!;
    const [downloadAction, historyAction] = result[0].actions!;
    expect(downloadAction.visible).toBe(false);
    expect(historyAction.visible).toBe(true);
    expect(result[0].description).toBe(block.description);
  });

  it('clears the description only once every action in the block is hidden', () => {
    const block = actionsBlock({
      actions: [
        { id: 'download-template', label: 'Download the official template', visible: true },
        { id: 'view-history', label: 'View history', visible: false },
      ],
    });
    const result = applyActionVisibility([block], { 'download-template': false })!;
    expect(result[0].description).toBeUndefined();
  });

  it('leaves non-actions-type blocks unchanged', () => {
    const infoBlock: FieldSupportingContent = { type: 'info', position: 'after', description: 'Some info.' };
    const result = applyActionVisibility([infoBlock], { 'download-template': false })!;
    expect(result[0]).toEqual(infoBlock);
  });

  it('leaves an actions block unchanged when none of its action ids are in the visibility map', () => {
    const block = actionsBlock();
    const result = applyActionVisibility([block], { 'some-other-action': false })!;
    expect(result[0]).toEqual(block);
  });

  it('never mutates the input array or its blocks', () => {
    const block = actionsBlock();
    const original = JSON.parse(JSON.stringify([block])) as FieldSupportingContent[];
    applyActionVisibility([block], { 'download-template': false });
    expect([block]).toEqual(original);
  });
});
