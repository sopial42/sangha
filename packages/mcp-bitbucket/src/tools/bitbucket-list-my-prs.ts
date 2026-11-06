import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getBitbucketEnv, isBitbucketEnvError } from "../lib/bitbucket";
import { logger } from "../logger";

export const bitbucketListMyPrsSchema = {
	name: "bitbucket_list_my_prs",
	description:
		"List pull requests across all repositories involving the calling user (Bitbucket Data Center dashboard), filtered by role (AUTHOR/REVIEWER/PARTICIPANT) and state.",
	args: {
		role: z
			.enum(["AUTHOR", "REVIEWER", "PARTICIPANT"])
			.optional()
			.describe("Only return PRs where the calling user has this role (default: server decides, typically AUTHOR)."),
		state: z
			.enum(["OPEN", "MERGED", "DECLINED", "ALL"])
			.optional()
			.default("OPEN")
			.describe("Pull request state to filter by (default: OPEN)."),
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

type BitbucketDashboardPr = {
	id: number;
	title: string;
	state: string;
	author: { user: { name: string } };
	toRef: {
		displayId: string;
		repository: { slug: string; project: { key: string } };
	};
	updatedDate: number;
};

type BitbucketDashboardPrResponse = {
	values: BitbucketDashboardPr[];
	isLastPage: boolean;
	nextPageStart?: number;
};

export function bitbucketListMyPrsTool(server: McpServer): void {
	const schema = bitbucketListMyPrsSchema;
	server.tool(
		schema.name,
		schema.description,
		schema.args,
		async ({ role, state, limit, start }) => {
			const env = getBitbucketEnv();
			if (isBitbucketEnvError(env)) return env;
			const { baseUrl, token } = env;

			const params = new URLSearchParams({
				start: String(start),
				limit: String(limit),
				state,
			});
			if (role) params.set("role", role);

			const url = `${baseUrl}/rest/api/1.0/dashboard/pull-requests?${params}`;
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

				const page = (await response.json()) as BitbucketDashboardPrResponse;
				const pullRequests = page.values.map((pr) => ({
					id: pr.id,
					title: pr.title,
					state: pr.state,
					author: pr.author.user.name,
					repo: `${pr.toRef.repository.project.key}/${pr.toRef.repository.slug}`,
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
								error: `Failed to list my PRs: ${error instanceof Error ? error.message : "Unknown error"}`,
							}),
						},
					],
					isError: true,
				};
			}
		},
	);
}
