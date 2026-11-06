import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getBitbucketEnv, isBitbucketEnvError } from "../lib/bitbucket";
import { logger } from "../logger";

export const bitbucketGetPrActivitiesSchema = {
	name: "bitbucket_get_pr_activities",
	description:
		"List activity on a Bitbucket Data Center pull request: comments (with reply threads flattened, their id/version/anchor/severity/state for bitbucket_edit_pr_comment or bitbucket_resolve_pr_comment) plus other events (approvals, reviews, rescopes, merges, declines...). Paginated.",
	args: {
		projectKey: z.string().describe('Bitbucket project key (e.g. "MYPROJ")'),
		repositorySlug: z.string().describe('Repository slug (e.g. "my-repo")'),
		pullRequestId: z.number().int().positive().describe("Pull request ID"),
		limit: z
			.number()
			.int()
			.positive()
			.max(200)
			.optional()
			.default(25)
			.describe("Max number of activities to return (default: 25)."),
		start: z
			.number()
			.int()
			.min(0)
			.optional()
			.default(0)
			.describe("Pagination offset (default: 0)."),
	},
} as const;

type BitbucketAnchor = {
	path?: string;
	line?: number;
	lineType?: string;
	fileType?: string;
};

type BitbucketComment = {
	id: number;
	version: number;
	text: string;
	author: { name: string };
	createdDate: number;
	updatedDate: number;
	severity?: string;
	state?: string;
	anchor?: BitbucketAnchor;
	comments?: BitbucketComment[];
};

type BitbucketActivity = {
	id: number;
	createdDate: number;
	user?: { name: string };
	action: string;
	comment?: BitbucketComment;
};

type BitbucketActivitiesResponse = {
	values: BitbucketActivity[];
	isLastPage: boolean;
	nextPageStart?: number;
};

type CommentEntry = {
	type: "comment";
	id: number;
	version: number;
	author: string;
	text: string;
	createdDate: number;
	updatedDate: number;
	severity?: string;
	state?: string;
	anchor?: BitbucketAnchor;
	parentId?: number;
};

type OtherEntry = { type: string; user?: string; date: number };

function flattenComment(
	comment: BitbucketComment,
	parentId?: number,
): CommentEntry[] {
	const entry: CommentEntry = {
		type: "comment",
		id: comment.id,
		version: comment.version,
		author: comment.author.name,
		text: comment.text,
		createdDate: comment.createdDate,
		updatedDate: comment.updatedDate,
		severity: comment.severity,
		state: comment.state,
		anchor: comment.anchor,
		parentId,
	};
	const replies = (comment.comments ?? []).flatMap((reply) =>
		flattenComment(reply, comment.id),
	);
	return [entry, ...replies];
}

export function bitbucketGetPrActivitiesTool(server: McpServer): void {
	const schema = bitbucketGetPrActivitiesSchema;
	server.tool(
		schema.name,
		schema.description,
		schema.args,
		async ({ projectKey, repositorySlug, pullRequestId, limit, start }) => {
			const env = getBitbucketEnv();
			if (isBitbucketEnvError(env)) return env;
			const { baseUrl, token } = env;

			const params = new URLSearchParams({
				start: String(start),
				limit: String(limit),
			});

			const url = `${baseUrl}/rest/api/1.0/projects/${encodeURIComponent(projectKey)}/repos/${encodeURIComponent(repositorySlug)}/pull-requests/${pullRequestId}/activities?${params}`;
			logger.log(`[mcp-bitbucket] GET ${url}`);

			try {
				const response = await fetch(url, {
					headers: { Authorization: `Bearer ${token}` },
				});

				if (!response.ok) {
					const errorText = await response.text();
					logger.error(
						`[mcp-bitbucket] Bitbucket API error: ${response.status} ${response.statusText}`,
						errorText.substring(0, 500),
					);
					return {
						content: [
							{
								type: "text" as const,
								text: JSON.stringify({
									error: `Bitbucket API error: ${response.status} ${response.statusText}`,
									details: errorText,
								}),
							},
						],
						isError: true,
					};
				}

				const page = (await response.json()) as BitbucketActivitiesResponse;
				const activities = page.values.flatMap(
					(activity): Array<CommentEntry | OtherEntry> => {
						if (activity.action === "COMMENTED" && activity.comment) {
							return flattenComment(activity.comment);
						}
						return [
							{
								type: activity.action,
								user: activity.user?.name,
								date: activity.createdDate,
							},
						];
					},
				);

				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify(
								{
									activities,
									isLastPage: page.isLastPage,
									nextPageStart: page.nextPageStart,
								},
								null,
								2,
							),
						},
					],
				};
			} catch (error) {
				logger.error("[mcp-bitbucket] Fetch error:", error);
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								error: `Failed to fetch PR activities: ${error instanceof Error ? error.message : "Unknown error"}`,
							}),
						},
					],
					isError: true,
				};
			}
		},
	);
}
