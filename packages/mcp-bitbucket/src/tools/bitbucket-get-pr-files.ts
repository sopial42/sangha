import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getBitbucketEnv, isBitbucketEnvError } from "../lib/bitbucket";
import { logger } from "../logger";

export const bitbucketGetPrFilesSchema = {
	name: "bitbucket_get_pr_files",
	description:
		"List all files changed in a Bitbucket Data Center pull request. Returns a lightweight list of file paths and their change types (ADD, MODIFY, DELETE, RENAME, COPY). Call this first to discover which files were changed, then call bitbucket_get_pr_diff with a specific filePath to get the structured diff for each file of interest.",
	args: {
		projectKey: z.string().describe('Bitbucket project key (e.g. "MYPROJ")'),
		repositorySlug: z.string().describe('Repository slug (e.g. "my-repo")'),
		pullRequestId: z.number().int().positive().describe("Pull request ID"),
	},
} as const;

type BitbucketChangesResponse = {
	values: Array<{
		type: "ADD" | "MODIFY" | "DELETE" | "RENAME" | "COPY";
		path: { toString: string };
	}>;
	isLastPage: boolean;
	nextPageStart?: number;
};

export function bitbucketGetPrFilesTool(server: McpServer): void {
	const schema = bitbucketGetPrFilesSchema;
	server.tool(
		schema.name,
		schema.description,
		schema.args,
		async ({ projectKey, repositorySlug, pullRequestId }) => {
			const env = getBitbucketEnv();
			if (isBitbucketEnvError(env)) return env;
			const { baseUrl, token } = env;

			const files: Array<{ path: string; changeType: string }> = [];
			let start = 0;
			const limit = 100;

			try {
				// Paginate through all changed files
				while (true) {
					const params = new URLSearchParams({
						start: String(start),
						limit: String(limit),
					});
					const url = `${baseUrl}/rest/api/latest/projects/${encodeURIComponent(projectKey)}/repos/${encodeURIComponent(repositorySlug)}/pull-requests/${pullRequestId}/changes?${params}`;

					logger.log(`[mcp-bitbucket] GET ${url}`);

					const response = await fetch(url, {
						method: "GET",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer ${token}`,
						},
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

					const page = (await response.json()) as BitbucketChangesResponse;

					for (const entry of page.values) {
						files.push({
							path: entry.path.toString,
							changeType: entry.type,
						});
					}

					if (page.isLastPage) break;
					if (page.nextPageStart === undefined) {
						throw new Error(
							"Bitbucket API returned isLastPage=false but did not provide nextPageStart",
						);
					}
					start = page.nextPageStart;
				}

				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({ files }, null, 2),
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
								error: `Failed to list PR files: ${error instanceof Error ? error.message : "Unknown error"}`,
							}),
						},
					],
					isError: true,
				};
			}
		},
	);
}
