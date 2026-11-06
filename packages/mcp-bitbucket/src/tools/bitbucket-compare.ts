import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getBitbucketEnv, isBitbucketEnvError } from "../lib/bitbucket";
import { type BitbucketDiffResponse, parseDiff } from "../lib/diff";
import { logger } from "../logger";

export const bitbucketCompareSchema = {
	name: "bitbucket_compare",
	description:
		"Compare two refs (branches, tags, or commits) in a Bitbucket Data Center repository: the commits between them, optionally the list of changed files (`includeChangedFiles`), or the structured diff of a single file (`filePath`).",
	args: {
		projectKey: z.string().describe('Bitbucket project key (e.g. "MYPROJ")'),
		repositorySlug: z.string().describe('Repository slug (e.g. "my-repo")'),
		fromRef: z.string().min(1).describe('Source ref (e.g. "feature/x", a tag, or a commit SHA).'),
		toRef: z.string().min(1).describe('Target ref to compare against (e.g. "master").'),
		includeChangedFiles: z
			.boolean()
			.optional()
			.default(false)
			.describe("Also list the files changed between the two refs (ignored if `filePath` is set)."),
		filePath: z
			.string()
			.optional()
			.describe(
				'If set, fetch the structured diff for this single file instead of the changed-files list (e.g. "src/foo.ts").',
			),
		contextLines: z
			.number()
			.int()
			.min(0)
			.optional()
			.default(10)
			.describe("Context lines around each diff hunk when `filePath` is set (default: 10)."),
		limit: z
			.number()
			.int()
			.positive()
			.max(200)
			.optional()
			.default(25)
			.describe("Max number of commits to return (default: 25)."),
		start: z
			.number()
			.int()
			.min(0)
			.optional()
			.default(0)
			.describe("Pagination offset for the commit list (default: 0)."),
	},
} as const;

type BitbucketCommit = {
	id: string;
	displayId: string;
	author: { name: string };
	authorTimestamp: number;
	message: string;
};

type BitbucketCommitsResponse = {
	values: BitbucketCommit[];
	isLastPage: boolean;
	nextPageStart?: number;
};

type BitbucketChange = {
	type: "ADD" | "MODIFY" | "DELETE" | "RENAME" | "COPY";
	path: { toString: string };
};

type BitbucketChangesResponse = {
	values: BitbucketChange[];
	isLastPage: boolean;
	nextPageStart?: number;
};

export function bitbucketCompareTool(server: McpServer): void {
	const schema = bitbucketCompareSchema;
	server.tool(
		schema.name,
		schema.description,
		schema.args,
		async ({
			projectKey,
			repositorySlug,
			fromRef,
			toRef,
			includeChangedFiles,
			filePath,
			contextLines,
			limit,
			start,
		}) => {
			const env = getBitbucketEnv();
			if (isBitbucketEnvError(env)) return env;
			const { baseUrl, token } = env;

			const base = `${baseUrl}/rest/api/1.0/projects/${encodeURIComponent(projectKey)}/repos/${encodeURIComponent(repositorySlug)}`;

			try {
				const commitsParams = new URLSearchParams({
					start: String(start),
					limit: String(limit),
					from: fromRef,
					to: toRef,
				});
				const commitsUrl = `${base}/compare/commits?${commitsParams}`;
				logger.log(`[mcp-bitbucket] GET ${commitsUrl}`);
				const commitsResponse = await fetch(commitsUrl, {
					headers: { Authorization: `Bearer ${token}` },
				});
				if (!commitsResponse.ok) return await apiError(commitsResponse);

				const commitsPage =
					(await commitsResponse.json()) as BitbucketCommitsResponse;
				const commits = commitsPage.values.map((c) => ({
					id: c.id,
					displayId: c.displayId,
					author: c.author.name,
					timestamp: c.authorTimestamp,
					summary: (c.message ?? "").split("\n")[0],
				}));

				const result: Record<string, unknown> = {
					commits,
					isLastPage: commitsPage.isLastPage,
					nextPageStart: commitsPage.nextPageStart,
				};

				if (filePath) {
					const encodedFilePath = filePath
						.split("/")
						.map(encodeURIComponent)
						.join("/");
					const diffParams = new URLSearchParams({
						from: fromRef,
						to: toRef,
						contextLines: String(contextLines),
					});
					const diffUrl = `${base}/compare/diff/${encodedFilePath}?${diffParams}`;
					logger.log(`[mcp-bitbucket] GET ${diffUrl}`);
					const diffResponse = await fetch(diffUrl, {
						headers: { Authorization: `Bearer ${token}` },
					});
					if (!diffResponse.ok) return await apiError(diffResponse);

					const rawDiff = (await diffResponse.json()) as BitbucketDiffResponse;
					result.diff = parseDiff(rawDiff);
				} else if (includeChangedFiles) {
					const changesParams = new URLSearchParams({
						start: "0",
						limit: "100",
						from: fromRef,
						to: toRef,
					});
					const changesUrl = `${base}/compare/changes?${changesParams}`;
					logger.log(`[mcp-bitbucket] GET ${changesUrl}`);
					const changesResponse = await fetch(changesUrl, {
						headers: { Authorization: `Bearer ${token}` },
					});
					if (!changesResponse.ok) return await apiError(changesResponse);

					const changesPage =
						(await changesResponse.json()) as BitbucketChangesResponse;
					result.changedFiles = changesPage.values.map((c) => ({
						path: c.path.toString,
						changeType: c.type,
					}));
					if (!changesPage.isLastPage) {
						result.changedFilesTruncationWarning =
							"More changed files exist than were returned (limit: 100). Narrow the comparison or use bitbucket_compare with filePath to inspect specific files.";
					}
				}

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
								error: `Failed to compare refs: ${error instanceof Error ? error.message : "Unknown error"}`,
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
