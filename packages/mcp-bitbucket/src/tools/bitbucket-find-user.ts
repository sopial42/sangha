import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getBitbucketEnv, isBitbucketEnvError } from "../lib/bitbucket";
import { logger } from "../logger";

export const bitbucketFindUserSchema = {
	name: "bitbucket_find_user",
	description:
		"Search Bitbucket Data Center users by name, display name, or email fragment. Use this to find a user's slug for the reviewers list of bitbucket_create_pr / bitbucket_update_pr.",
	args: {
		query: z
			.string()
			.min(1)
			.describe('Text to search for (e.g. "jdoe" or "John").'),
		limit: z
			.number()
			.int()
			.positive()
			.max(200)
			.optional()
			.default(25)
			.describe("Max number of users to return (default: 25)."),
		start: z
			.number()
			.int()
			.min(0)
			.optional()
			.default(0)
			.describe("Pagination offset (default: 0)."),
	},
} as const;

type BitbucketUser = {
	slug: string;
	displayName: string;
	emailAddress?: string;
	active: boolean;
};

type BitbucketUsersResponse = {
	values: BitbucketUser[];
	isLastPage: boolean;
	nextPageStart?: number;
};

export function bitbucketFindUserTool(server: McpServer): void {
	const schema = bitbucketFindUserSchema;
	server.tool(
		schema.name,
		schema.description,
		schema.args,
		async ({ query, limit, start }) => {
			const env = getBitbucketEnv();
			if (isBitbucketEnvError(env)) return env;
			const { baseUrl, token } = env;

			const params = new URLSearchParams({
				filter: query,
				start: String(start),
				limit: String(limit),
			});
			const url = `${baseUrl}/rest/api/1.0/users?${params}`;
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

				const page = (await response.json()) as BitbucketUsersResponse;
				const users = page.values.map((u) => ({
					slug: u.slug,
					displayName: u.displayName,
					emailAddress: u.emailAddress,
					active: u.active,
				}));

				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify(
								{
									users,
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
								error: `Failed to search users: ${error instanceof Error ? error.message : "Unknown error"}`,
							}),
						},
					],
					isError: true,
				};
			}
		},
	);
}
