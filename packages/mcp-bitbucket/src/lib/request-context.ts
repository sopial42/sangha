import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-request Bitbucket credentials.
 *
 * In multi-user HTTP mode these come from request headers (each user sends
 * their own PAT). In single-user / stdio mode they are absent and the tools
 * fall back to environment variables.
 */
export type BitbucketCredentials = {
	token?: string;
	userSlug?: string;
};

const storage = new AsyncLocalStorage<BitbucketCredentials>();

/**
 * Run `fn` with the given per-request credentials bound to the async context.
 * Tool handlers invoked while the returned promise is pending can read them
 * back via `getRequestCredentials()`.
 */
export function runWithCredentials<T>(
	creds: BitbucketCredentials,
	fn: () => T,
): T {
	return storage.run(creds, fn);
}

/** Read the credentials bound to the current async context (empty if none). */
export function getRequestCredentials(): BitbucketCredentials {
	return storage.getStore() ?? {};
}
