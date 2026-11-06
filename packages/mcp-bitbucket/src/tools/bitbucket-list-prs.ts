import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getBitbucketEnv, isBitbucketEnvError } from "../lib/bitbucket";
import { logger } from "../logger";

export const bitbucketListPrsSchema = {
	name: "bitbucket_list_prs",
	description:
		"List pull requests in a Bitbucket Data Center repository, filtered by state, direction, source/target branch, text, or role/username.",
	args: {
		projectKey: z.string().describe('Bitbucket project key (e.g. "MYPROJ")'),
		repositorySlug: z.string().describe('Repository slug (e.g. "my-repo")'),
		state: z
			.enum(["OPEN", "MERGED", "DECLINED", "ALL"])
			.optional()
			.default("OPEN")
			.describe("Pull request state to filter by (default: OPEN)."),
		direction: z
			.enum(["INCOMING", "OUTGOING"])
			.optional()
			.describe("Direction relative to `at` (requires `at` to be set)."),
		at: z
			.string()
			.optional()
			.describe('Branch ref to filter by (e.g. "refs/heads/master"), used with `direction`.'),
		filterText: z
			.string()
			.optional()
			.describe("Only return PRs whose title/description/author/reviewer match this text."),
		role: z
			.enum(["AUTHOR", "REVIEWER", "PARTICIPANT"])
			.optional()
			.describe("Role `username` must have on the PR. Requires `username`."),
		username: z
			.string()
			.optional()
			.describe("User slug to filter by `role` for. Requires `role`."),
		limit: z
			.number()
			.int()
			.positive()
			.max(200)
			.optional()
			.default(25)
			.describe("Max number of PRs to return (default: 25)."),
		start: z
			.number()
			.int()
			.min(0)
			.optional()
			.default(0)
			.describe("Pagination offset (default: 0)."),
	},
} as const;

type BitbucketPrSummary = {
	id: number;
	title: string;
	state: string;
	author: { user: { name: string } };
	fromRef: { displayId: string };
	toRef: { displayId: string };
	updatedDate: number;
};

type BitbucketPrListResponse = {
	values: BitbucketPrSummary[];
	isLastPage: boolean;
	nextPageStart?: number;
};

export function bitbucketListPrsTool(server: McpServer): void {
	const schema = bitbucketListPrsSchema;
	server.tool(
		schema.name,
		schema.description,
		schema.args,
		async ({
			projectKey,
			repositorySlug,
			state,
			direction,
			at,
			filterText,
			role,
			username,
			limit,
			start,
		}) => {
			const env = getBitbucketEnv();
			if (isBitbucketEnvError(env)) return env;
			const { baseUrl, token } = env;

			const params = new URLSearchParams({
				start: String(start),
				limit: String(limit),
				state,
			});
			if (direction) params.set("direction", direction);
			if (at) params.set("at", at);
			if (filterText) params.set("filterText", filterText);
			if (role) params.set("role.1", role);
			if (username) params.set("username.1", username);

			const url = `${baseUrl}/rest/api/1.0/projects/${encodeURIComponent(projectKey)}/repos/${encodeURIComponent(repositorySlug)}/pull-requests?${params}`;
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

				const page = (await response.json()) as BitbucketPrListResponse;
				const pullRequests = page.values.map((pr) => ({
					id: pr.id,
					title: pr.title,
					state: pr.state,
					author: pr.author.user.name,
					fromRef: pr.fromRef.displayId,
					toRef: pr.toRef.displayId,
					updatedDate: pr.updatedDate,
				}));

				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify(
								{
									pullRequests,
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
								error: `Failed to list PRs: ${error instanceof Error ? error.message : "Unknown error"}`,
							}),
						},
					],
					isError: true,
				};
			}
		},
	);
}
