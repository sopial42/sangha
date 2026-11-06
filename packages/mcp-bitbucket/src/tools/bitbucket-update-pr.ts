import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getBitbucketEnv, isBitbucketEnvError } from "../lib/bitbucket";
import { normalizeRef } from "../lib/refs";
import { logger } from "../logger";

export const bitbucketUpdatePrSchema = {
	name: "bitbucket_update_pr",
	description:
		"Update a Bitbucket Data Center pull request's title, description, target branch, and/or reviewers. Fetches the PR first to preserve whatever you don't explicitly change (Bitbucket's update PUT would otherwise wipe reviewers / description). At least one of title, description, appendDescription, targetBranch, or reviewers must be set.",
	args: {
		projectKey: z.string().describe('Bitbucket project key (e.g. "MYPROJ")'),
		repositorySlug: z.string().describe('Repository slug (e.g. "my-repo")'),
		pullRequestId: z.number().int().positive().describe("Pull request ID"),
		title: z.string().min(1).optional().describe("New title (unchanged if omitted)."),
		description: z
			.string()
			.optional()
			.describe("New description, replacing the current one (unchanged if omitted). Mutually exclusive with `appendDescription`."),
		appendDescription: z
			.string()
			.optional()
			.describe("Text to append to the current description (separated by a blank line). Mutually exclusive with `description`."),
		targetBranch: z
			.string()
			.optional()
			.describe('New target branch (e.g. "master"); the "refs/heads/" prefix is added automatically if missing.'),
		reviewers: z
			.array(z.string())
			.optional()
			.describe("Reviewer user slugs to add (default) or, with reviewersMode=replace, to replace the current list with."),
		reviewersMode: z
			.enum(["add", "replace"])
			.optional()
			.default("add")
			.describe("How to apply `reviewers`: add to the current list (default) or replace it entirely."),
	},
} as const;

type BitbucketUserRef = { name: string };

type BitbucketPrDetails = {
	version: number;
	title: string;
	description?: string;
	toRef: {
		id: string;
		repository: { slug: string; project: { key: string } };
	};
	reviewers: Array<{ user: BitbucketUserRef }>;
};

export function bitbucketUpdatePrTool(server: McpServer): void {
	const schema = bitbucketUpdatePrSchema;
	server.tool(
		schema.name,
		schema.description,
		schema.args,
		async ({
			projectKey,
			repositorySlug,
			pullRequestId,
			title,
			description,
			appendDescription,
			targetBranch,
			reviewers,
			reviewersMode,
		}) => {
			if (description !== undefined && appendDescription !== undefined) {
				throw new Error(
					"Provide either `description` or `appendDescription`, not both.",
				);
			}

			if (
				title === undefined &&
				description === undefined &&
				appendDescription === undefined &&
				targetBranch === undefined &&
				reviewers === undefined
			) {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								error:
									"Nothing to update: set at least one of title, description, appendDescription, targetBranch, or reviewers.",
							}),
						},
					],
					isError: true,
				};
			}

			const env = getBitbucketEnv();
			if (isBitbucketEnvError(env)) return env;
			const { baseUrl, token } = env;

			const url = `${baseUrl}/rest/api/1.0/projects/${encodeURIComponent(projectKey)}/repos/${encodeURIComponent(repositorySlug)}/pull-requests/${pullRequestId}`;

			try {
				logger.log(`[mcp-bitbucket] GET ${url}`);
				const getResponse = await fetch(url, {
					headers: { Authorization: `Bearer ${token}` },
				});
				if (!getResponse.ok) return await apiError(getResponse);
				const current = (await getResponse.json()) as BitbucketPrDetails;

				const newTitle = title ?? current.title;

				let newDescription = current.description;
				if (description !== undefined) newDescription = description;
				else if (appendDescription !== undefined) {
					newDescription = current.description
						? `${current.description}\n\n${appendDescription}`
						: appendDescription;
				}

				const newToRef = targetBranch
					? {
							id: normalizeRef(targetBranch),
							repository: {
								slug: repositorySlug,
								project: { key: projectKey },
							},
						}
					: current.toRef;

				const existingReviewerSlugs = current.reviewers.map((r) => r.user.name);
				let newReviewerSlugs = existingReviewerSlugs;
				if (reviewers !== undefined) {
					newReviewerSlugs =
						reviewersMode === "replace"
							? [...new Set(reviewers)]
							: [...new Set([...existingReviewerSlugs, ...reviewers])];
				}

				const body = {
					version: current.version,
					title: newTitle,
					description: newDescription,
					toRef: newToRef,
					reviewers: newReviewerSlugs.map((slug) => ({ user: { name: slug } })),
				};

				logger.log(`[mcp-bitbucket] PUT ${url}`);
				const putResponse = await fetch(url, {
					method: "PUT",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${token}`,
					},
					body: JSON.stringify(body),
				});
				if (!putResponse.ok) return await apiError(putResponse);

				const result = await putResponse.json();
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
								error: `Failed to update PR: ${error instanceof Error ? error.message : "Unknown error"}`,
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
