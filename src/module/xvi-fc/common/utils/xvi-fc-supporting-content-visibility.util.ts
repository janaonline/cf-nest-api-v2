import type { FieldSupportingContent } from '../types/field-config.type';

/**
 * Toggles the `visible` flag on named actions within `actions`-type supportingContent
 * blocks, and keeps each block's `description` paired to them: when every action in a
 * block ends up invisible, the description (which only exists to explain those actions)
 * is cleared too, so hiding an action can never leave an orphaned description behind.
 * Blocks with no matching action id, or whose type isn't `actions`, pass through
 * unchanged. Never mutates the input.
 */
export function applyActionVisibility(
  supportingContent: FieldSupportingContent[] | undefined,
  visibilityByActionId: Record<string, boolean>,
): FieldSupportingContent[] | undefined {
  if (!supportingContent) return supportingContent;

  return supportingContent.map((block) => {
    if (block.type !== 'actions' || !block.actions) return block;

    const actions = block.actions.map((action) =>
      action.id in visibilityByActionId ? { ...action, visible: visibilityByActionId[action.id] } : action,
    );
    const anyVisible = actions.some((action) => action.visible !== false);

    return { ...block, description: anyVisible ? block.description : undefined, actions };
  });
}
