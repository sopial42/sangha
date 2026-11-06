import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
	getBitbucketEnv,
	isBitbucketEnvError,
	updatePrComment,
} from "../lib/bitbucket";
import { logger } from "../logger";

export const bitbucketEditPrCommentSchema = {
	name: "bitbucket_edit_pr_comment",
	description:
		"Edit the text of an existing comment (or task) on a Bitbucket Data Center pull request. Its severity and resolution state are preserved.",
	args: {
		projectKey: z.string().describe('Bitbucket project key (e.g. "MYPROJ")'),
		repositorySlug: z.string().describe('Repository slug (e.g. "my-repo")'),
		pullRequestId: z.number().int().positive().describe("Pull request ID"),
		commentId: z.number().int().positive().describe("Comment ID (from bitbucket_get_pr_activities)."),
		text: z.string().min(1).describe("New comment text."),
	},
} as const;

export function bitbucketEditPrCommentTool(server: McpServer): void {
	const schema = bitbucketEditPrCommentSchema;
	server.tool(
		schema.name,
		schema.description,
		schema.args,
		async ({ projectKey, repositorySlug, pullRequestId, commentId, text }) => {
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
					{ text },
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
								error: `Failed to edit comment: ${error instanceof Error ? error.message : "Unknown error"}`,
							}),
						},
					],
					isError: true,
				};
			}
		},
	);
}
