import type { FieldSupportingContent } from '../types/field-config.type';
import {
  applyActionVisibility,
  findSupportingAction,
  stripSupportingContentMeta,
} from './xvi-fc-supporting-content-visibility.util';

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

describe('findSupportingAction', () => {
  it('finds an action by id within a single block', () => {
    const block = actionsBlock();
    const found = findSupportingAction([block], 'download-template');
    expect(found).toBe(block.actions![0]);
  });

  it('finds an action across multiple blocks', () => {
    const otherBlock = actionsBlock({ actions: [{ id: 'view-history', label: 'View history', visible: true }] });
    const targetBlock = actionsBlock();
    const found = findSupportingAction([otherBlock, targetBlock], 'download-template');
    expect(found).toBe(targetBlock.actions![0]);
  });

  it('returns undefined when no block contains a matching action id', () => {
    expect(findSupportingAction([actionsBlock()], 'not-an-action')).toBeUndefined();
  });

  it('returns undefined when supportingContent is undefined', () => {
    expect(findSupportingAction(undefined, 'download-template')).toBeUndefined();
  });

  it('returns undefined when a block has no actions array', () => {
    const infoBlock: FieldSupportingContent = { type: 'info', position: 'after', description: 'Some info.' };
    expect(findSupportingAction([infoBlock], 'download-template')).toBeUndefined();
  });
});

describe('stripSupportingContentMeta', () => {
  it('removes meta from every action while leaving other action fields untouched', () => {
    const block = actionsBlock({
      actions: [
        {
          id: 'download-template',
          label: 'Download the official template',
          visible: true,
          meta: { path: 'internal/s3/key.docx', fileName: 'Template.docx', mimeType: 'application/msword' },
        },
      ],
    });
    const result = stripSupportingContentMeta([block])!;
    expect(result[0].actions![0]).not.toHaveProperty('meta');
    expect(result[0].actions![0]).toEqual({
      id: 'download-template',
      label: 'Download the official template',
      visible: true,
    });
  });

  it('strips meta across multiple blocks/actions', () => {
    const blockA = actionsBlock({
      actions: [{ id: 'a', label: 'A', visible: true, meta: { secret: 1 } }],
    });
    const blockB = actionsBlock({
      actions: [{ id: 'b', label: 'B', visible: true, meta: { secret: 2 } }],
    });
    const result = stripSupportingContentMeta([blockA, blockB])!;
    expect(result[0].actions![0]).not.toHaveProperty('meta');
    expect(result[1].actions![0]).not.toHaveProperty('meta');
  });

  it('leaves blocks with no meta on their actions unchanged in shape', () => {
    const block = actionsBlock();
    const result = stripSupportingContentMeta([block])!;
    expect(result[0]).toEqual(block);
  });

  it('returns undefined unchanged when supportingContent is undefined', () => {
    expect(stripSupportingContentMeta(undefined)).toBeUndefined();
  });

  it('never mutates the input array or its blocks', () => {
    const block = actionsBlock({
      actions: [{ id: 'download-template', label: 'Download', visible: true, meta: { path: 'x' } }],
    });
    const original = JSON.parse(JSON.stringify([block])) as FieldSupportingContent[];
    stripSupportingContentMeta([block]);
    expect([block]).toEqual(original);
  });
});
