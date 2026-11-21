/** True for data strings that are still placeholders ("TODO: ..."), so pages can highlight them. */
export const isPlaceholder = (value: string): boolean => value.trim().startsWith('TODO');
