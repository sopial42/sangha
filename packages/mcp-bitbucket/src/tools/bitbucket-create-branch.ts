import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getBitbucketEnv, isBitbucketEnvError } from "../lib/bitbucket";
import { logger } from "../logger";

export const bitbucketCreateBranchSchema = {
	name: "bitbucket_create_branch",
	description:
		"Create a new branch in a Bitbucket Data Center repository. Returns the created branch's ref details (id, displayId, latestCommit, type).",
	args: {
		projectKey: z.string().describe('Bitbucket project key (e.g. "MYPROJ")'),
		repositorySlug: z.string().describe('Repository slug (e.g. "my-repo")'),
		name: z
			.string()
			.min(1)
			.describe(
				'Branch name to create (e.g. "feature/my-change"). Do not include the "refs/heads/" prefix.',
			),
		startPoint: z
			.string()
			.min(1)
			.describe(
				'Commit SHA or ref to branch from (e.g. "master", "refs/heads/master", or a full commit SHA).',
			),
	},
} as const;

export function bitbucketCreateBranchTool(server: McpServer): void {
	const schema = bitbucketCreateBranchSchema;
	server.tool(
		schema.name,
		schema.description,
		schema.args,
		async ({ projectKey, repositorySlug, name, startPoint }) => {
			const env = getBitbucketEnv();
			if (isBitbucketEnvError(env)) return env;
			const { baseUrl, token } = env;

			const url = `${baseUrl}/rest/branch-utils/latest/projects/${encodeURIComponent(projectKey)}/repos/${encodeURIComponent(repositorySlug)}/branches`;
			logger.log(`[mcp-bitbucket] POST ${url}`);

			try {
				const response = await fetch(url, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${token}`,
					},
					body: JSON.stringify({ name, startPoint }),
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
								error: `Failed to create branch: ${error instanceof Error ? error.message : "Unknown error"}`,
							}),
						},
					],
					isError: true,
				};
			}
		},
	);
}
