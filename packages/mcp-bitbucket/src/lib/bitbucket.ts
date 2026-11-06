import { logger } from "../logger";
import { errorResponse, type McpErrorResponse } from "./mcp";
import { getRequestCredentials } from "./request-context";

export type { McpErrorResponse };

// ── Credentials guard ─────────────────────────────────────────────────────────

export type BitbucketEnv = { baseUrl: string; token: string };

const NOT_CONFIGURED_ERROR = errorResponse(
	"Bitbucket base URL is not configured on the server.",
);

const NO_TOKEN_ERROR = errorResponse(
	"No Bitbucket token provided. Send it in the 'X-Bitbucket-Token' header (multi-user HTTP mode) or set BITBUCKET_TOKEN (local mode).",
);

/**
 * Resolve the Bitbucket base URL (always server-side config) and the caller's
 * token. The token is read from the per-request context first (header-based
 * multi-user mode), falling back to BITBUCKET_TOKEN (single-user / stdio mode).
 *
 * Returns a typed error response (ready to return from a tool) if anything is
 * missing, or the resolved values otherwise.
 */
export function getBitbucketEnv(): BitbucketEnv | McpErrorResponse {
	const baseUrl = process.env.BITBUCKET_API_BASE_URL;
	if (!baseUrl) {
		logger.error("BITBUCKET_API_BASE_URL is not set");
		return NOT_CONFIGURED_ERROR;
	}

	const token = getRequestCredentials().token ?? process.env.BITBUCKET_TOKEN;
	if (!token) {
		logger.error("No Bitbucket token (header or BITBUCKET_TOKEN)");
		return NO_TOKEN_ERROR;
	}

	return { baseUrl, token };
}

/**
 * Resolve the Bitbucket user slug for the current caller — from the per-request
 * context first (header-based multi-user mode), falling back to
 * BITBUCKET_USER_SLUG (single-user / stdio mode). Undefined if neither is set.
 */
export function getBitbucketUserSlug(): string | undefined {
	return getRequestCredentials().userSlug ?? process.env.BITBUCKET_USER_SLUG;
}

/**
 * Type guard — narrows the result of getBitbucketEnv() to the error branch.
 * Usage:
 *   const env = getBitbucketEnv();
 *   if (isBitbucketEnvError(env)) return env;
 *   const { baseUrl, token } = env;
 */
export function isBitbucketEnvError(
	v: BitbucketEnv | McpErrorResponse,
): v is McpErrorResponse {
	return "isError" in v;
}

// ── PR helpers ────────────────────────────────────────────────────────────────

/**
 * Fetch the current version of a pull request (needed for optimistic locking).
 * Bitbucket DC requires the current `version` to be passed on any state-mutating PR operation.
 */
export async function fetchPrVersion(
	baseUrl: string,
	token: string,
	projectKey: string,
	repositorySlug: string,
	pullRequestId: number,
): Promise<number> {
	const url = `${baseUrl}/rest/api/latest/projects/${encodeURIComponent(projectKey)}/repos/${encodeURIComponent(repositorySlug)}/pull-requests/${pullRequestId}`;
	logger.log(`[mcp-bitbucket] GET ${url}`);

	const response = await fetch(url, {
		headers: { Authorization: `Bearer ${token}` },
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(
			`Failed to fetch PR version: ${response.status} ${response.statusText} – ${errorText.substring(0, 300)}`,
		);
	}

	const data = (await response.json()) as { version: number };
	return data.version;
}

/**
 * Update the current user's participant status on a pull request.
 * Used by bitbucket_approve_pr (APPROVED), bitbucket_request_changes_pr (NEEDS_WORK),
 * and bitbucket_unapprove_pr (UNAPPROVED, resetting a previous approval/review).
 * Automatically fetches the current PR version for optimistic locking.
 */
export async function updateParticipantStatus(
	baseUrl: string,
	token: string,
	projectKey: string,
	repositorySlug: string,
	pullRequestId: number,
	userSlug: string,
	status: "APPROVED" | "NEEDS_WORK" | "UNAPPROVED",
): Promise<unknown> {
	const version = await fetchPrVersion(
		baseUrl,
		token,
		projectKey,
		repositorySlug,
		pullRequestId,
	);

	const url = `${baseUrl}/rest/api/latest/projects/${encodeURIComponent(projectKey)}/repos/${encodeURIComponent(repositorySlug)}/pull-requests/${pullRequestId}/participants/${encodeURIComponent(userSlug)}`;
	logger.log(`[mcp-bitbucket] PUT ${url}`);

	const response = await fetch(url, {
		method: "PUT",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${token}`,
		},
		body: JSON.stringify({ status, user: { slug: userSlug }, version }),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(
			`Bitbucket API error: ${response.status} ${response.statusText} – ${errorText.substring(0, 500)}`,
		);
	}

	return response.json();
}

// ── Comment helpers ───────────────────────────────────────────────────────────

export type BitbucketCommentDetails = {
	id: number;
	version: number;
	text: string;
	severity?: "NORMAL" | "BLOCKER";
	state?: "OPEN" | "RESOLVED";
};

/** Fetch a single comment's current representation (needed for optimistic locking). */
export async function fetchPrComment(
	baseUrl: string,
	token: string,
	projectKey: string,
	repositorySlug: string,
	pullRequestId: number,
	commentId: number,
): Promise<BitbucketCommentDetails> {
	const url = `${baseUrl}/rest/api/latest/projects/${encodeURIComponent(projectKey)}/repos/${encodeURIComponent(repositorySlug)}/pull-requests/${pullRequestId}/comments/${commentId}`;
	logger.log(`[mcp-bitbucket] GET ${url}`);

	const response = await fetch(url, {
		headers: { Authorization: `Bearer ${token}` },
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(
			`Failed to fetch comment: ${response.status} ${response.statusText} – ${errorText.substring(0, 300)}`,
		);
	}

	return (await response.json()) as BitbucketCommentDetails;
}

/**
 * Update a comment's text and/or severity and/or resolution state. Fields not
 * passed in `overrides` are read back from the comment first and resent
 * unchanged — Bitbucket DC's comment PUT is a full representation, so sending
 * only the field you meant to change would wipe out the others.
 */
export async function updatePrComment(
	baseUrl: string,
	token: string,
	projectKey: string,
	repositorySlug: string,
	pullRequestId: number,
	commentId: number,
	overrides: { text?: string; severity?: "NORMAL" | "BLOCKER"; state?: "OPEN" | "RESOLVED" },
): Promise<unknown> {
	const current = await fetchPrComment(
		baseUrl,
		token,
		projectKey,
		repositorySlug,
		pullRequestId,
		commentId,
	);

	const url = `${baseUrl}/rest/api/latest/projects/${encodeURIComponent(projectKey)}/repos/${encodeURIComponent(repositorySlug)}/pull-requests/${pullRequestId}/comments/${commentId}`;
	logger.log(`[mcp-bitbucket] PUT ${url}`);

	const body = {
		text: overrides.text ?? current.text,
		severity: overrides.severity ?? current.severity,
		state: overrides.state ?? current.state,
		version: current.version,
	};

	const response = await fetch(url, {
		method: "PUT",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${token}`,
		},
		body: JSON.stringify(body),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(
			`Bitbucket API error: ${response.status} ${response.statusText} – ${errorText.substring(0, 500)}`,
		);
	}

	return response.json();
}
