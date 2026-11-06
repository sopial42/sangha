import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getBitbucketEnv, isBitbucketEnvError } from "../lib/bitbucket";
import { logger } from "../logger";

export const bitbucketListCommitsSchema = {
	name: "bitbucket_list_commits",
	description:
		"List commits on a ref (or affecting a path) in a Bitbucket Data Center repository. Returns a compact list (the commit message is summarized to its first line); use bitbucket_get_file_content / bitbucket_compare for details.",
	args: {
		projectKey: z.string().describe('Bitbucket project key (e.g. "MYPROJ")'),
		repositorySlug: z.string().describe('Repository slug (e.g. "my-repo")'),
		ref: z
			.string()
			.optional()
			.describe('Branch, tag, or commit to list from (e.g. "master"). Defaults to the repository\'s default branch.'),
		path: z
			.string()
			.optional()
			.describe("Only list commits that affect this file or directory path."),
		limit: z
			.number()
			.int()
			.positive()
			.max(200)
			.optional()
			.default(25)
			.describe("Max number of commits to return (default: 25)."),
		start: z
			.number()
			.int()
			.min(0)
			.optional()
			.default(0)
			.describe("Pagination offset (default: 0)."),
	},
} as const;

type BitbucketCommit = {
	id: string;
	displayId: string;
	author: { name: string };
	authorTimestamp: number;
	message: string;
};

type BitbucketCommitsResponse = {
	values: BitbucketCommit[];
	isLastPage: boolean;
	nextPageStart?: number;
};

export function bitbucketListCommitsTool(server: McpServer): void {
	const schema = bitbucketListCommitsSchema;
	server.tool(
		schema.name,
		schema.description,
		schema.args,
		async ({ projectKey, repositorySlug, ref, path, limit, start }) => {
			const env = getBitbucketEnv();
			if (isBitbucketEnvError(env)) return env;
			const { baseUrl, token } = env;

			const params = new URLSearchParams({
				start: String(start),
				limit: String(limit),
			});
			if (ref) params.set("until", ref);
			if (path) params.set("path", path);

			const url = `${baseUrl}/rest/api/1.0/projects/${encodeURIComponent(projectKey)}/repos/${encodeURIComponent(repositorySlug)}/commits?${params}`;
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

				const page = (await response.json()) as BitbucketCommitsResponse;
				const commits = page.values.map((c) => ({
					id: c.id,
					displayId: c.displayId,
					author: c.author.name,
					timestamp: c.authorTimestamp,
					summary: (c.message ?? "").split("\n")[0],
				}));

				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify(
								{
									commits,
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
								error: `Failed to list commits: ${error instanceof Error ? error.message : "Unknown error"}`,
							}),
						},
					],
					isError: true,
				};
			}
		},
	);
}
