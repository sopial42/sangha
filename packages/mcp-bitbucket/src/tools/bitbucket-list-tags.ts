import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getBitbucketEnv, isBitbucketEnvError } from "../lib/bitbucket";
import { logger } from "../logger";

export const bitbucketListTagsSchema = {
	name: "bitbucket_list_tags",
	description:
		"List tags in a Bitbucket Data Center repository, optionally filtered by text.",
	args: {
		projectKey: z.string().describe('Bitbucket project key (e.g. "MYPROJ")'),
		repositorySlug: z.string().describe('Repository slug (e.g. "my-repo")'),
		filterText: z
			.string()
			.optional()
			.describe("Optional substring to filter tag names by."),
		limit: z
			.number()
			.int()
			.positive()
			.max(200)
			.optional()
			.default(25)
			.describe("Max number of tags to return (default: 25)."),
		start: z
			.number()
			.int()
			.min(0)
			.optional()
			.default(0)
			.describe("Pagination offset (default: 0)."),
	},
} as const;

type BitbucketTag = {
	id: string;
	displayId: string;
	latestCommit: string;
};

type BitbucketTagsResponse = {
	values: BitbucketTag[];
	isLastPage: boolean;
	nextPageStart?: number;
};

export function bitbucketListTagsTool(server: McpServer): void {
	const schema = bitbucketListTagsSchema;
	server.tool(
		schema.name,
		schema.description,
		schema.args,
		async ({ projectKey, repositorySlug, filterText, limit, start }) => {
			const env = getBitbucketEnv();
			if (isBitbucketEnvError(env)) return env;
			const { baseUrl, token } = env;

			const params = new URLSearchParams({
				start: String(start),
				limit: String(limit),
			});
			if (filterText) params.set("filterText", filterText);

			const url = `${baseUrl}/rest/api/1.0/projects/${encodeURIComponent(projectKey)}/repos/${encodeURIComponent(repositorySlug)}/tags?${params}`;
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

				const page = (await response.json()) as BitbucketTagsResponse;
				const tags = page.values.map((t) => ({
					id: t.id,
					displayId: t.displayId,
					latestCommit: t.latestCommit,
				}));

				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify(
								{
									tags,
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
								error: `Failed to list tags: ${error instanceof Error ? error.message : "Unknown error"}`,
							}),
						},
					],
					isError: true,
				};
			}
		},
	);
}
