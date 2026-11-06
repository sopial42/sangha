import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getBitbucketEnv, isBitbucketEnvError } from "../lib/bitbucket";
import {
	type BitbucketDiffResponse,
	parseDiff,
} from "../lib/diff";
import { logger } from "../logger";

export const bitbucketGetPrDiffSchema = {
	name: "bitbucket_get_pr_diff",
	description:
		"Fetch the structured diff for a single file in a Bitbucket Data Center pull request. Returns a list of changed lines annotated with lineType (ADDED/REMOVED/CONTEXT) and fileType (FROM/TO) needed to post an inline comment via bitbucket_add_pr_comment. Call bitbucket_get_pr_files first to discover which files were changed.",
	args: {
		projectKey: z.string().describe('Bitbucket project key (e.g. "MYPROJ")'),
		repositorySlug: z.string().describe('Repository slug (e.g. "my-repo")'),
		pullRequestId: z.number().int().positive().describe("Pull request ID"),
		filePath: z
			.string()
			.describe(
				'File path to fetch the diff for (e.g. "src/foo.ts"). Use bitbucket_get_pr_files to list available paths.',
			),
		contextLines: z
			.number()
			.int()
			.min(0)
			.optional()
			.default(10)
			.describe(
				"Number of unchanged context lines to include around each change hunk (default: 10).",
			),
	},
} as const;

// ── Tool registration ─────────────────────────────────────────────────────────

export function bitbucketGetPrDiffTool(server: McpServer): void {
	const schema = bitbucketGetPrDiffSchema;
	server.tool(
		schema.name,
		schema.description,
		schema.args,
		async ({
			projectKey,
			repositorySlug,
			pullRequestId,
			filePath,
			contextLines,
		}) => {
			const env = getBitbucketEnv();
			if (isBitbucketEnvError(env)) return env;
			const { baseUrl, token } = env;

			const encodedFilePath = filePath
				.split("/")
				.map(encodeURIComponent)
				.join("/");
			const params = new URLSearchParams({
				contextLines: String(contextLines),
			});
			const url = `${baseUrl}/rest/api/latest/projects/${encodeURIComponent(projectKey)}/repos/${encodeURIComponent(repositorySlug)}/pull-requests/${pullRequestId}/diff/${encodedFilePath}?${params}`;

			logger.log(`[mcp-bitbucket] GET ${url}`);

			try {
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

				const raw = (await response.json()) as BitbucketDiffResponse;
				const { files, truncated } = parseDiff(raw);

				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify(
								{
									truncated,
									...(truncated && {
										truncationWarning:
											"The diff was truncated by the Bitbucket API. The data above is partial. This file may be too large to retrieve completely via the API. Consider commenting at the file level rather than inline, or ask the user to confirm they want to proceed with the partial diff.",
									}),
									files,
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
								error: `Failed to fetch PR diff: ${error instanceof Error ? error.message : "Unknown error"}`,
							}),
						},
					],
					isError: true,
				};
			}
		},
	);
}
