/** Add the "refs/heads/" prefix to a branch name if it isn't already a full ref. */
export function normalizeRef(ref: string): string {
	return ref.startsWith("refs/") ? ref : `refs/heads/${ref}`;
}
