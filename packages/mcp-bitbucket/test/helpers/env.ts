import { afterEach, beforeEach } from "vitest";

export const TEST_BASE_URL = "https://stash.example.test";
export const TEST_TOKEN = "test-token";

/**
 * Sets BITBUCKET_API_BASE_URL / BITBUCKET_TOKEN for the duration of a test
 * file (single-user / stdio mode, same as tools fall back to in local use),
 * and restores whatever was there before.
 */
export function useBitbucketEnv(): void {
	let prevBaseUrl: string | undefined;
	let prevToken: string | undefined;
	let prevUserSlug: string | undefined;

	beforeEach(() => {
		prevBaseUrl = process.env.BITBUCKET_API_BASE_URL;
		prevToken = process.env.BITBUCKET_TOKEN;
		prevUserSlug = process.env.BITBUCKET_USER_SLUG;
		process.env.BITBUCKET_API_BASE_URL = TEST_BASE_URL;
		process.env.BITBUCKET_TOKEN = TEST_TOKEN;
	});

	afterEach(() => {
		setOrDelete("BITBUCKET_API_BASE_URL", prevBaseUrl);
		setOrDelete("BITBUCKET_TOKEN", prevToken);
		setOrDelete("BITBUCKET_USER_SLUG", prevUserSlug);
	});
}

function setOrDelete(key: string, value: string | undefined): void {
	if (value === undefined) delete process.env[key];
	else process.env[key] = value;
}
