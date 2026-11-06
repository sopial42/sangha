import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
	getBitbucketEnv,
	isBitbucketEnvError,
	updatePrComment,
} from "../lib/bitbucket";
import { logger } from "../logger";

export const bitbucketResolvePrCommentSchema = {
	name: "bitbucket_resolve_pr_comment",
	description:
		"Resolve (or reopen) a comment thread / task on a Bitbucket Data Center pull request. Its text and severity are preserved.",
	args: {
		projectKey: z.string().describe('Bitbucket project key (e.g. "MYPROJ")'),
		repositorySlug: z.string().describe('Repository slug (e.g. "my-repo")'),
		pullRequestId: z.number().int().positive().describe("Pull request ID"),
		commentId: z.number().int().positive().describe("Comment ID (from bitbucket_get_pr_activities)."),
		state: z
			.enum(["RESOLVED", "OPEN"])
			.optional()
			.default("RESOLVED")
			.describe("New resolution state (default: RESOLVED). Use OPEN to reopen a resolved thread."),
	},
} as const;

export function bitbucketResolvePrCommentTool(server: McpServer): void {
	const schema = bitbucketResolvePrCommentSchema;
	server.tool(
		schema.name,
		schema.description,
		schema.args,
		async ({ projectKey, repositorySlug, pullRequestId, commentId, state }) => {
			const env = getBitbucketEnv();
			if (isBitbucketEnvError(env)) return env;
			const { baseUrl, token } = env;

			try {
				const result = await updatePrComment(
					baseUrl,
					token,
					projectKey,
					repositorySlug,
					pullRequestId,
					commentId,
					{ state },
				);
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
								error: `Failed to update comment resolution: ${error instanceof Error ? error.message : "Unknown error"}`,
							}),
						},
					],
					isError: true,
				};
			}
		},
	);
}
