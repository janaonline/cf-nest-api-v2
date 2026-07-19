import type { FieldSupportingContent, SupportingContentAction } from '../types/field-config.type';

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

/** Finds one action by id within a field's supportingContent blocks. */
export function findSupportingAction(
  supportingContent: FieldSupportingContent[] | undefined,
  actionId: string,
): SupportingContentAction | undefined {
  for (const block of supportingContent ?? []) {
    const found = block.actions?.find((action) => action.id === actionId);
    if (found) return found;
  }
  return undefined;
}

/**
 * Strips `meta` from every supportingContent action before a field reaches an API
 * response. `meta` is a backend-only extension point (e.g. a raw S3 path backing a
 * template-download action) — it must never leak to the client un-stripped. Never
 * mutates the input.
 */
export function stripSupportingContentMeta(
  supportingContent: FieldSupportingContent[] | undefined,
): FieldSupportingContent[] | undefined {
  if (!supportingContent) return supportingContent;

  return supportingContent.map((block) => ({
    ...block,
    actions: block.actions?.map(({ meta: _meta, ...rest }) => rest),
  }));
}
