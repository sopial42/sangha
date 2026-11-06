import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
	fetchPrVersion,
	getBitbucketEnv,
	isBitbucketEnvError,
} from "../lib/bitbucket";
import { logger } from "../logger";

export const bitbucketMergePrSchema = {
	name: "bitbucket_merge_pr",
	description:
		"Merge a Bitbucket Data Center pull request. THIS IS AN IRREVERSIBLE, OUTWARD-FACING ACTION — only call it when the user explicitly asked you to merge this PR. Checks mergeability first (via the same check as bitbucket_get_pr) and refuses with the vetoes if the PR cannot currently be merged, instead of forcing anything.",
	args: {
		projectKey: z.string().describe('Bitbucket project key (e.g. "MYPROJ")'),
		repositorySlug: z.string().describe('Repository slug (e.g. "my-repo")'),
		pullRequestId: z.number().int().positive().describe("Pull request ID"),
		message: z.string().optional().describe("Optional custom merge commit message."),
		strategyId: z
			.string()
			.optional()
			.describe('Optional merge strategy id configured on the repository (e.g. "squash", "ff", "no-ff").'),
	},
} as const;

type BitbucketMergeCheck = {
	canMerge: boolean;
	conflicted: boolean;
	vetoes: Array<{ summaryMessage: string; detailedMessage?: string }>;
};

export function bitbucketMergePrTool(server: McpServer): void {
	const schema = bitbucketMergePrSchema;
	server.tool(
		schema.name,
		schema.description,
		schema.args,
		async ({ projectKey, repositorySlug, pullRequestId, message, strategyId }) => {
			const env = getBitbucketEnv();
			if (isBitbucketEnvError(env)) return env;
			const { baseUrl, token } = env;

			const base = `${baseUrl}/rest/api/1.0/projects/${encodeURIComponent(projectKey)}/repos/${encodeURIComponent(repositorySlug)}/pull-requests/${pullRequestId}`;

			try {
				const mergeCheckUrl = `${base}/merge`;
				logger.log(`[mcp-bitbucket] GET ${mergeCheckUrl}`);
				const checkResponse = await fetch(mergeCheckUrl, {
					headers: { Authorization: `Bearer ${token}` },
				});
				if (!checkResponse.ok) return await apiError(checkResponse);
				const check = (await checkResponse.json()) as BitbucketMergeCheck;

				if (!check.canMerge) {
					return {
						content: [
							{
								type: "text" as const,
								text: JSON.stringify({
									error: "Pull request cannot be merged.",
									conflicted: check.conflicted,
									vetoes: check.vetoes.map((v) => v.summaryMessage),
								}),
							},
						],
						isError: true,
					};
				}

				const version = await fetchPrVersion(
					baseUrl,
					token,
					projectKey,
					repositorySlug,
					pullRequestId,
				);

				type MergeBody = { message?: string; strategyId?: string };
				const body: MergeBody = {};
				if (message) body.message = message;
				if (strategyId) body.strategyId = strategyId;

				const mergeUrl = `${base}/merge?version=${version}`;
				logger.log(`[mcp-bitbucket] POST ${mergeUrl}`);
				const mergeResponse = await fetch(mergeUrl, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${token}`,
					},
					body: JSON.stringify(body),
				});
				if (!mergeResponse.ok) return await apiError(mergeResponse);

				const result = await mergeResponse.json();
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
								error: `Failed to merge PR: ${error instanceof Error ? error.message : "Unknown error"}`,
							}),
						},
					],
					isError: true,
				};
			}
		},
	);
}

async function apiError(response: Response): Promise<{
	content: [{ type: "text"; text: string }];
	isError: true;
}> {
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
