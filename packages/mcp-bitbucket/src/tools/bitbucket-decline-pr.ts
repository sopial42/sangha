import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
	fetchPrVersion,
	getBitbucketEnv,
	isBitbucketEnvError,
} from "../lib/bitbucket";
import { logger } from "../logger";

export const bitbucketDeclinePrSchema = {
	name: "bitbucket_decline_pr",
	description:
		"Decline a Bitbucket Data Center pull request, optionally providing a reason comment.",
	args: {
		projectKey: z.string().describe('Bitbucket project key (e.g. "MYPROJ")'),
		repositorySlug: z.string().describe('Repository slug (e.g. "my-repo")'),
		pullRequestId: z.number().int().positive().describe("Pull request ID"),
		comment: z
			.string()
			.optional()
			.describe("Optional reason for declining the pull request."),
	},
} as const;

export function bitbucketDeclinePrTool(server: McpServer): void {
	const schema = bitbucketDeclinePrSchema;
	server.tool(
		schema.name,
		schema.description,
		schema.args,
		async ({ projectKey, repositorySlug, pullRequestId, comment }) => {
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

				const url = `${baseUrl}/rest/api/latest/projects/${encodeURIComponent(projectKey)}/repos/${encodeURIComponent(repositorySlug)}/pull-requests/${pullRequestId}/decline?version=${version}`;
				logger.log(`[mcp-bitbucket] POST ${url}`);

				const body =
					comment !== undefined ? JSON.stringify({ text: comment }) : undefined;

				const response = await fetch(url, {
					method: "POST",
					headers: {
						// Omit Content-Type when there is no body: sending it on a bodyless POST
						// causes some Bitbucket DC versions to expect (and fail to parse) a JSON
						// body, resulting in a 400 Bad Request even though no body is required.
						...(body !== undefined
							? { "Content-Type": "application/json" }
							: {}),
						Authorization: `Bearer ${token}`,
					},
					...(body !== undefined ? { body } : {}),
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
								error: `Failed to decline PR: ${error instanceof Error ? error.message : "Unknown error"}`,
							}),
						},
					],
					isError: true,
				};
			}
		},
	);
}
