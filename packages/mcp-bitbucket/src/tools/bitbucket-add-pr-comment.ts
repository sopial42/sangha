import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getBitbucketEnv, isBitbucketEnvError } from "../lib/bitbucket";
import { logger } from "../logger";

export const bitbucketAddPrCommentSchema = {
	name: "bitbucket_add_pr_comment",
	description:
		"Add a comment to a Bitbucket Data Center pull request. The comment can be global (top-level) or inline, targeting a specific file and line. Set `parentCommentId` to reply to an existing comment instead.",
	args: {
		projectKey: z.string().describe('Bitbucket project key (e.g. "MYPROJ")'),
		repositorySlug: z.string().describe('Repository slug (e.g. "my-repo")'),
		pullRequestId: z.number().int().positive().describe("Pull request ID"),
		text: z.string().min(1).describe("Comment text"),
		filePath: z
			.string()
			.optional()
			.describe(
				'File path for an inline comment (e.g. "src/foo.ts"). Requires `line` to also be set.',
			),
		line: z
			.number()
			.int()
			.positive()
			.optional()
			.describe(
				"Line number for an inline comment. Requires `filePath` to also be set.",
			),
		lineType: z
			.enum(["ADDED", "REMOVED", "CONTEXT"])
			.optional()
			.default("ADDED")
			.describe("Which side of the diff the line belongs to (default: ADDED)."),
		fileType: z
			.enum(["FROM", "TO"])
			.optional()
			.default("TO")
			.describe(
				"Whether the line is in the source (FROM) or destination (TO) file (default: TO).",
			),
		parentCommentId: z
			.number()
			.int()
			.positive()
			.optional()
			.describe(
				"If set, post this as a reply to an existing comment (its id, from bitbucket_get_pr_activities) instead of a new top-level comment.",
			),
	},
} as const;

export function bitbucketAddPrCommentTool(server: McpServer): void {
	const schema = bitbucketAddPrCommentSchema;
	server.tool(
		schema.name,
		schema.description,
		schema.args,
		async ({
			projectKey,
			repositorySlug,
			pullRequestId,
			text,
			filePath,
			line,
			lineType,
			fileType,
			parentCommentId,
		}) => {
			const env = getBitbucketEnv();
			if (isBitbucketEnvError(env)) return env;
			const { baseUrl, token } = env;

			// Validate: filePath and line must both be present or both absent
			const hasFilePath = filePath !== undefined && filePath !== "";
			const hasLine = line !== undefined;
			if (hasFilePath !== hasLine) {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								error:
									"For inline comments, both `filePath` and `line` must be provided together.",
							}),
						},
					],
					isError: true,
				};
			}

			const url = `${baseUrl}/rest/api/latest/projects/${encodeURIComponent(projectKey)}/repos/${encodeURIComponent(repositorySlug)}/pull-requests/${pullRequestId}/comments`;

			type CommentBody = {
				text: string;
				anchor?: {
					line: number;
					lineType: "ADDED" | "REMOVED" | "CONTEXT";
					fileType: "FROM" | "TO";
					path: string;
				};
				parent?: { id: number };
			};

			const body: CommentBody = { text };
			if (hasFilePath && hasLine) {
				body.anchor = {
					line: line,
					lineType: lineType,
					fileType: fileType,
					path: filePath,
				};
			}
			if (parentCommentId !== undefined) {
				body.parent = { id: parentCommentId };
			}

			logger.log(`[mcp-bitbucket] POST ${url}`);

			try {
				const response = await fetch(url, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${token}`,
					},
					body: JSON.stringify(body),
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
						{
							type: "text" as const,
							text: JSON.stringify(result, null, 2),
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
								error: `Failed to add PR comment: ${error instanceof Error ? error.message : "Unknown error"}`,
							}),
						},
					],
					isError: true,
				};
			}
		},
	);
}
