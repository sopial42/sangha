import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
	fetchPrVersion,
	getBitbucketEnv,
	isBitbucketEnvError,
} from "../lib/bitbucket";
import { logger } from "../logger";

export const bitbucketReopenPrSchema = {
	name: "bitbucket_reopen_pr",
	description:
		"Reopen a previously declined Bitbucket Data Center pull request, putting it back into OPEN state.",
	args: {
		projectKey: z.string().describe('Bitbucket project key (e.g. "MYPROJ")'),
		repositorySlug: z.string().describe('Repository slug (e.g. "my-repo")'),
		pullRequestId: z.number().int().positive().describe("Pull request ID"),
	},
} as const;

export function bitbucketReopenPrTool(server: McpServer): void {
	const schema = bitbucketReopenPrSchema;
	server.tool(
		schema.name,
		schema.description,
		schema.args,
		async ({ projectKey, repositorySlug, pullRequestId }) => {
			const env = getBitbucketEnv();
			if (isBitbucketEnvError(env)) return env;
			const { baseUrl, token } = env;

			try {
				const version = await fetchPrVersion(
					baseUrl,
					token,
					projectKey,
					repositorySlug,
					pullRequestId,
				);

				const url = `${baseUrl}/rest/api/latest/projects/${encodeURIComponent(projectKey)}/repos/${encodeURIComponent(repositorySlug)}/pull-requests/${pullRequestId}/reopen?version=${version}`;
				logger.log(`[mcp-bitbucket] POST ${url}`);

				const response = await fetch(url, {
					method: "POST",
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

				const result = await response.json();
				return {
					content: [
						{ type: "text" as const, text: JSON.stringify(result, null, 2) },
					],
				};
			} catch (error) {
				logger.error("[mcp-bitbucket] Fetch error:", error);
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								error: `Failed to reopen PR: ${error instanceof Error ? error.message : "Unknown error"}`,
							}),
						},
					],
					isError: true,
				};
			}
		},
	);
}
