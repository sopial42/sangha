import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getBitbucketEnv, isBitbucketEnvError } from "../lib/bitbucket";
import { errorResponse } from "../lib/mcp";
import { logger } from "../logger";

type BitbucketPullRequest = {
	id: number;
	title: string;
	closedDate?: number;
	author: { user: { displayName: string } };
	toRef: { displayId: string };
	links: { self: Array<{ href: string }> };
};

type BitbucketPrListResponse = {
	values: BitbucketPullRequest[];
	isLastPage: boolean;
	nextPageStart?: number;
};

type BitbucketCommit = {
	displayId: string;
	message: string;
};

type BitbucketCommitsResponse = {
	values: BitbucketCommit[];
	isLastPage: boolean;
	nextPageStart?: number;
};

const DEFAULT_TICKET_PATTERN = "[A-Z][A-Z0-9]+-\\d+";

async function fetchMergedReleasePrs(
	baseUrl: string,
	token: string,
	projectKey: string,
	repositorySlug: string,
	titlePrefix: string,
	targetBranch: string,
	cutoff: number,
): Promise<BitbucketPullRequest[]> {
	const prs: BitbucketPullRequest[] = [];
	let start = 0;

	while (true) {
		const params = new URLSearchParams({
			state: "MERGED",
			start: String(start),
			limit: "50",
		});

		const url = `${baseUrl}/rest/api/latest/projects/${encodeURIComponent(projectKey)}/repos/${encodeURIComponent(repositorySlug)}/pull-requests?${params}`;
		logger.log(`[mcp-bitbucket] GET ${url}`);

		const response = await fetch(url, {
			headers: { Authorization: `Bearer ${token}` },
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(
				`Bitbucket API error on ${projectKey}/${repositorySlug}: ${response.status} ${response.statusText} – ${errorText.substring(0, 300)}`,
			);
		}

		const page = (await response.json()) as BitbucketPrListResponse;

		let reachedCutoff = false;
		for (const pr of page.values) {
			if (pr.closedDate !== undefined && pr.closedDate < cutoff) {
				reachedCutoff = true;
				break;
			}
			if (!pr.title.startsWith(titlePrefix)) continue;
			if (pr.toRef.displayId !== targetBranch) continue;
			prs.push(pr);
		}

		if (reachedCutoff || page.isLastPage) break;
		if (page.nextPageStart === undefined) break;
		start = page.nextPageStart;
	}

	return prs;
}

async function fetchAllCommitMessages(
	baseUrl: string,
	token: string,
	projectKey: string,
	repositorySlug: string,
	pullRequestId: number,
): Promise<string[]> {
	const messages: string[] = [];
	let start = 0;

	while (true) {
		const params = new URLSearchParams({ start: String(start), limit: "100" });
		const url = `${baseUrl}/rest/api/latest/projects/${encodeURIComponent(projectKey)}/repos/${encodeURIComponent(repositorySlug)}/pull-requests/${pullRequestId}/commits?${params}`;
		logger.log(`[mcp-bitbucket] GET ${url}`);

		const response = await fetch(url, {
			headers: { Authorization: `Bearer ${token}` },
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(
				`Bitbucket API error fetching commits for PR #${pullRequestId}: ${response.status} ${response.statusText} – ${errorText.substring(0, 300)}`,
			);
		}

		const page = (await response.json()) as BitbucketCommitsResponse;
		for (const commit of page.values) {
			messages.push(commit.message);
		}

		if (page.isLastPage) break;
		if (page.nextPageStart === undefined) break;
		start = page.nextPageStart;
	}

	return messages;
}

export function bitbucketFindTicketsInReleasePrsTool(server: McpServer): void {
	server.tool(
		"bitbucket_find_tickets_in_release_prs",
		"Find issue/ticket IDs referenced in commit messages of recently merged release PRs across multiple Bitbucket repositories. The ticket key format and the PR title prefix are configurable. When filterTicketKeys is provided, returns only the intersection of those keys with what was found in PR commits — use this to avoid LLM-side matching errors.",
		{
			repos: z
				.array(
					z.object({
						projectKey: z
							.string()
							.describe('Bitbucket project key (e.g. "PROJ")'),
						repositorySlug: z
							.string()
							.describe('Repository slug (e.g. "my-service")'),
					}),
				)
				.describe("List of repositories to scan"),
			titlePrefix: z
				.string()
				.optional()
				.default("[RELEASE]")
				.describe('PR title prefix to match (default: "[RELEASE]")'),
			targetBranch: z
				.string()
				.optional()
				.default("master")
				.describe('Target branch of the PRs (default: "master")'),
			maxAgeDays: z
				.number()
				.optional()
				.default(7)
				.describe("Only scan PRs merged within this many days (default: 7)"),
			ticketPattern: z
				.string()
				.optional()
				.default(DEFAULT_TICKET_PATTERN)
				.describe(
					`Regular expression matching ticket keys in commit messages (default: "${DEFAULT_TICKET_PATTERN}", matches e.g. "PROJ-123"). Provide a narrower pattern like "AIP-\\\\d+" to match a single project.`,
				),
			filterTicketKeys: z
				.array(z.string())
				.optional()
				.describe(
					"If provided, only ticket IDs present in this list are returned (intersection with what was found in PR commits). Pass your ticket keys here to get back only those that are actually ready to close — no LLM matching required.",
				),
		},
		async ({
			repos,
			titlePrefix,
			targetBranch,
			maxAgeDays,
			ticketPattern,
			filterTicketKeys,
		}) => {
			const env = getBitbucketEnv();
			if (isBitbucketEnvError(env)) return env;
			const { baseUrl, token } = env;

			// Short-circuit: if caller provided an empty filter list, nothing can match.
			if (filterTicketKeys !== undefined && filterTicketKeys.length === 0) {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								scannedRepos: 0,
								totalReleasePrs: 0,
								ticketIds: {},
							}),
						},
					],
				};
			}

			const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
			const filterSet = filterTicketKeys
				? new Set(filterTicketKeys)
				: undefined;

			let ticketRegex: RegExp;
			try {
				ticketRegex = new RegExp(ticketPattern, "g");
			} catch {
				return errorResponse(
					`Invalid ticketPattern (not a valid regular expression): ${ticketPattern}`,
				);
			}

			// ticketId -> list of PRs that reference it
			const ticketMap: Record<
				string,
				Array<{ prId: number; prTitle: string; repo: string }>
			> = {};

			const errors: string[] = [];
			let totalPrs = 0;

			try {
				for (const { projectKey, repositorySlug } of repos) {
					let prs: BitbucketPullRequest[];
					try {
						prs = await fetchMergedReleasePrs(
							baseUrl,
							token,
							projectKey,
							repositorySlug,
							titlePrefix,
							targetBranch,
							cutoff,
						);
					} catch (err) {
						const msg = err instanceof Error ? err.message : String(err);
						logger.error(`[mcp-bitbucket] ${msg}`);
						errors.push(msg);
						continue;
					}

					totalPrs += prs.length;
					logger.log(
						`[mcp-bitbucket] ${projectKey}/${repositorySlug}: ${prs.length} matching PRs`,
					);

					for (const pr of prs) {
						let commitMessages: string[];
						try {
							commitMessages = await fetchAllCommitMessages(
								baseUrl,
								token,
								projectKey,
								repositorySlug,
								pr.id,
							);
						} catch (err) {
							const msg = err instanceof Error ? err.message : String(err);
							logger.error(`[mcp-bitbucket] ${msg}`);
							errors.push(msg);
							continue;
						}

						const ticketIds = new Set<string>();
						for (const message of commitMessages) {
							for (const match of message.matchAll(ticketRegex)) {
								ticketIds.add(match[0]);
							}
						}

						for (const ticketId of ticketIds) {
							if (!ticketMap[ticketId]) ticketMap[ticketId] = [];
							ticketMap[ticketId].push({
								prId: pr.id,
								prTitle: pr.title,
								repo: repositorySlug,
							});
						}
					}
				}

				const filteredTicketIds = filterSet
					? Object.fromEntries(
							Object.entries(ticketMap).filter(([key]) => filterSet.has(key)),
						)
					: ticketMap;

				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify(
								{
									scannedRepos: repos.length,
									totalReleasePrs: totalPrs,
									ticketIds: filteredTicketIds,
									errors: errors.length > 0 ? errors : undefined,
								},
								null,
								2,
							),
						},
					],
				};
			} catch (error) {
				logger.error("[mcp-bitbucket] Unexpected error:", error);
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								error: `Unexpected error: ${error instanceof Error ? error.message : "Unknown error"}`,
							}),
						},
					],
					isError: true,
				};
			}
		},
	);
}
