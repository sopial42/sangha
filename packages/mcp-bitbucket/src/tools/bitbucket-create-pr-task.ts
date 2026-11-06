import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getBitbucketEnv, isBitbucketEnvError } from "../lib/bitbucket";
import { logger } from "../logger";

export const bitbucketCreatePrTaskSchema = {
	name: "bitbucket_create_pr_task",
	description:
		"Create a task (a blocker comment, severity BLOCKER) on a Bitbucket Data Center pull request — something that must be addressed before the PR can be merged. Can be global or anchored to a file/line like bitbucket_add_pr_comment. Resolve it later with bitbucket_resolve_pr_comment.",
	args: {
		projectKey: z.string().describe('Bitbucket project key (e.g. "MYPROJ")'),
		repositorySlug: z.string().describe('Repository slug (e.g. "my-repo")'),
		pullRequestId: z.number().int().positive().describe("Pull request ID"),
		text: z.string().min(1).describe("Task text."),
		filePath: z
			.string()
			.optional()
			.describe(
				'File path to anchor the task to (e.g. "src/foo.ts"). Requires `line` to also be set.',
			),
		line: z
			.number()
			.int()
			.positive()
			.optional()
			.describe("Line number to anchor the task to. Requires `filePath` to also be set."),
		lineType: z
			.enum(["ADDED", "REMOVED", "CONTEXT"])
			.optional()
			.default("ADDED")
			.describe("Which side of the diff the line belongs to (default: ADDED)."),
		fileType: z
			.enum(["FROM", "TO"])
			.optional()
			.default("TO")
			.describe("Whether the line is in the source (FROM) or destination (TO) file (default: TO)."),
	},
} as const;

export function bitbucketCreatePrTaskTool(server: McpServer): void {
	const schema = bitbucketCreatePrTaskSchema;
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
		}) => {
			const env = getBitbucketEnv();
			if (isBitbucketEnvError(env)) return env;
			const { baseUrl, token } = env;

			const hasFilePath = filePath !== undefined && filePath !== "";
			const hasLine = line !== undefined;
			if (hasFilePath !== hasLine) {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								error:
									"To anchor a task to a line, both `filePath` and `line` must be provided together.",
							}),
						},
					],
					isError: true,
				};
			}

			type TaskBody = {
				text: string;
				severity: "BLOCKER";
				anchor?: {
					line: number;
					lineType: "ADDED" | "REMOVED" | "CONTEXT";
					fileType: "FROM" | "TO";
					path: string;
				};
			};

			const body: TaskBody = { text, severity: "BLOCKER" };
			if (hasFilePath && hasLine) {
				body.anchor = { line, lineType, fileType, path: filePath };
			}

			const url = `${baseUrl}/rest/api/latest/projects/${encodeURIComponent(projectKey)}/repos/${encodeURIComponent(repositorySlug)}/pull-requests/${pullRequestId}/comments`;
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
								error: `Failed to create PR task: ${error instanceof Error ? error.message : "Unknown error"}`,
							}),
						},
					],
					isError: true,
				};
			}
		},
	);
}
