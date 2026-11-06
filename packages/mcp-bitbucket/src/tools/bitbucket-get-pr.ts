import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getBitbucketEnv, isBitbucketEnvError } from "../lib/bitbucket";
import { logger } from "../logger";

export const bitbucketGetPrSchema = {
	name: "bitbucket_get_pr",
	description:
		"Fetch full details of a Bitbucket Data Center pull request: title, description, state, author, reviewers (with approval status), source/target branches, version (needed for bitbucket_update_pr / bitbucket_merge_pr), and whether it can currently be merged (vetoes if not).",
	args: {
		projectKey: z.string().describe('Bitbucket project key (e.g. "MYPROJ")'),
		repositorySlug: z.string().describe('Repository slug (e.g. "my-repo")'),
		pullRequestId: z.number().int().positive().describe("Pull request ID"),
	},
} as const;

type BitbucketUserRef = { name: string; displayName?: string };

type BitbucketPrDetails = {
	id: number;
	version: number;
	title: string;
	description?: string;
	state: string;
	open: boolean;
	closed: boolean;
	locked?: boolean;
	author: { user: BitbucketUserRef };
	reviewers: Array<{
		user: BitbucketUserRef;
		approved: boolean;
		status: string;
	}>;
	participants?: Array<{
		user: BitbucketUserRef;
		approved: boolean;
		status: string;
		role: string;
	}>;
	fromRef: { displayId: string; latestCommit?: string };
	toRef: { displayId: string; latestCommit?: string };
	createdDate: number;
	updatedDate: number;
	links?: { self?: Array<{ href: string }> };
};

type BitbucketMergeCheck = {
	canMerge: boolean;
	conflicted: boolean;
	vetoes: Array<{ summaryMessage: string; detailedMessage?: string }>;
};

export function bitbucketGetPrTool(server: McpServer): void {
	const schema = bitbucketGetPrSchema;
	server.tool(
		schema.name,
		schema.description,
		schema.args,
		async ({ projectKey, repositorySlug, pullRequestId }) => {
			const env = getBitbucketEnv();
			if (isBitbucketEnvError(env)) return env;
			const { baseUrl, token } = env;

			const base = `${baseUrl}/rest/api/1.0/projects/${encodeURIComponent(projectKey)}/repos/${encodeURIComponent(repositorySlug)}/pull-requests/${pullRequestId}`;

			try {
				const [prResponse, mergeResponse] = await Promise.all([
					fetchJson<BitbucketPrDetails>(base, token),
					fetchJson<BitbucketMergeCheck>(`${base}/merge`, token),
				]);

				if ("error" in prResponse) return prResponse.error;
				if ("error" in mergeResponse) return mergeResponse.error;

				const pr = prResponse.data;
				const merge = mergeResponse.data;

				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify(
								{
									id: pr.id,
									version: pr.version,
									title: pr.title,
									description: pr.description,
									state: pr.state,
									open: pr.open,
									closed: pr.closed,
									locked: pr.locked,
									author: pr.author.user.name,
									reviewers: pr.reviewers.map((r) => ({
										user: r.user.name,
										approved: r.approved,
										status: r.status,
									})),
									fromRef: pr.fromRef.displayId,
									toRef: pr.toRef.displayId,
									createdDate: pr.createdDate,
									updatedDate: pr.updatedDate,
									url: pr.links?.self?.[0]?.href,
									mergeable: {
										canMerge: merge.canMerge,
										conflicted: merge.conflicted,
										vetoes: merge.vetoes.map((v) => v.summaryMessage),
									},
								},
								null,
								2,
							),
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
								error: `Failed to fetch PR: ${error instanceof Error ? error.message : "Unknown error"}`,
							}),
						},
					],
					isError: true,
				};
			}
		},
	);
}

type FetchResult<T> =
	| { data: T }
	| {
			error: {
				content: [{ type: "text"; text: string }];
				isError: true;
			};
	  };

async function fetchJson<T>(url: string, token: string): Promise<FetchResult<T>> {
	logger.log(`[mcp-bitbucket] GET ${url}`);
	const response = await fetch(url, {
		headers: { Authorization: `Bearer ${token}` },
	});

	if (!response.ok) {
		const errorText = await response.text();
		logger.error(
			`[mcp-bitbucket] Bitbucket API error: ${response.status} ${response.statusText}`,
			errorText.substring(0, 500),
		);
		return {
			error: {
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
			},
		};
	}

	return { data: (await response.json()) as T };
}
