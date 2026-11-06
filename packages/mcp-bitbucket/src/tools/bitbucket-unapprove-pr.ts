import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
	getBitbucketEnv,
	getBitbucketUserSlug,
	isBitbucketEnvError,
	updateParticipantStatus,
} from "../lib/bitbucket";
import { errorResponse } from "../lib/mcp";
import { logger } from "../logger";

export const bitbucketUnapprovePrSchema = {
	name: "bitbucket_unapprove_pr",
	description:
		"Reset the calling user's review status on a Bitbucket Data Center pull request back to UNAPPROVED (undoes a previous approve or request-changes), identified by the X-Bitbucket-User-Slug header, or BITBUCKET_USER_SLUG in local mode.",
	args: {
		projectKey: z.string().describe('Bitbucket project key (e.g. "MYPROJ")'),
		repositorySlug: z.string().describe('Repository slug (e.g. "my-repo")'),
		pullRequestId: z.number().int().positive().describe("Pull request ID"),
	},
} as const;

export function bitbucketUnapprovePrTool(server: McpServer): void {
	const schema = bitbucketUnapprovePrSchema;
	server.tool(
		schema.name,
		schema.description,
		schema.args,
		async ({ projectKey, repositorySlug, pullRequestId }) => {
			const env = getBitbucketEnv();
			if (isBitbucketEnvError(env)) return env;
			const { baseUrl, token } = env;

			const userSlug = getBitbucketUserSlug();
			if (!userSlug)
				return errorResponse(
					"No Bitbucket user slug provided. Send it in the 'X-Bitbucket-User-Slug' header (multi-user HTTP mode) or set BITBUCKET_USER_SLUG (local mode).",
				);

			try {
				const result = await updateParticipantStatus(
					baseUrl,
					token,
					projectKey,
					repositorySlug,
					pullRequestId,
					userSlug,
					"UNAPPROVED",
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
								error: `Failed to reset review status on PR: ${error instanceof Error ? error.message : "Unknown error"}`,
							}),
						},
					],
					isError: true,
				};
			}
		},
	);
}
