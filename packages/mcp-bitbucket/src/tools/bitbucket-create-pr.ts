import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getBitbucketEnv, isBitbucketEnvError } from "../lib/bitbucket";
import { logger } from "../logger";

export const bitbucketCreatePrSchema = {
	name: "bitbucket_create_pr",
	description:
		"Create a new pull request in a Bitbucket Data Center repository. Source and destination branches must already exist (use bitbucket_create_branch first if needed). Returns the created PR's id, version, title, state, and links.",
	args: {
		projectKey: z.string().describe('Bitbucket project key (e.g. "MYPROJ")'),
		repositorySlug: z.string().describe('Repository slug (e.g. "my-repo")'),
		title: z.string().min(1).describe("Pull request title."),
		description: z
			.string()
			.optional()
			.describe("Pull request description (markdown supported)."),
		fromBranch: z
			.string()
			.min(1)
			.describe(
				'Source branch name (e.g. "feature/my-change"). The "refs/heads/" prefix is added automatically if missing.',
			),
		toBranch: z
			.string()
			.min(1)
			.describe(
				'Destination branch name (e.g. "master"). The "refs/heads/" prefix is added automatically if missing.',
			),
		reviewers: z
			.array(z.string())
			.optional()
			.describe("Optional list of reviewer user slugs."),
		draft: z
			.boolean()
			.optional()
			.describe("If true, create the PR as a draft."),
	},
} as const;

function normalizeRef(ref: string): string {
	return ref.startsWith("refs/") ? ref : `refs/heads/${ref}`;
}

export function bitbucketCreatePrTool(server: McpServer): void {
	const schema = bitbucketCreatePrSchema;
	server.tool(
		schema.name,
		schema.description,
		schema.args,
		async ({
			projectKey,
			repositorySlug,
			title,
			description,
			fromBranch,
			toBranch,
			reviewers,
			draft,
		}) => {
			const env = getBitbucketEnv();
			if (isBitbucketEnvError(env)) return env;
			const { baseUrl, token } = env;

			const repoRef = {
				repository: {
					slug: repositorySlug,
					project: { key: projectKey },
				},
			};

			type PrBody = {
				title: string;
				description?: string;
				fromRef: { id: string } & typeof repoRef;
				toRef: { id: string } & typeof repoRef;
				reviewers?: { user: { name: string } }[];
				draft?: boolean;
			};

			const body: PrBody = {
				title,
				fromRef: { id: normalizeRef(fromBranch), ...repoRef },
				toRef: { id: normalizeRef(toBranch), ...repoRef },
			};
			if (description) body.description = description;
			if (reviewers && reviewers.length > 0) {
				body.reviewers = reviewers.map((slug) => ({ user: { name: slug } }));
			}
			if (draft) body.draft = true;

			const url = `${baseUrl}/rest/api/latest/projects/${encodeURIComponent(projectKey)}/repos/${encodeURIComponent(repositorySlug)}/pull-requests`;
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
								error: `Failed to create PR: ${error instanceof Error ? error.message : "Unknown error"}`,
							}),
						},
					],
					isError: true,
				};
			}
		},
	);
}
