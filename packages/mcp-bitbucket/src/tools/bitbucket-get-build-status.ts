import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getBitbucketEnv, isBitbucketEnvError } from "../lib/bitbucket";
import { logger } from "../logger";

export const bitbucketGetBuildStatusSchema = {
	name: "bitbucket_get_build_status",
	description:
		"Fetch CI build statuses reported against a commit in Bitbucket Data Center (via the build-status REST plugin).",
	args: {
		commitId: z
			.string()
			.min(1)
			.describe("Full or abbreviated commit SHA to look up build statuses for."),
		limit: z
			.number()
			.int()
			.positive()
			.max(200)
			.optional()
			.default(25)
			.describe("Max number of statuses to return (default: 25)."),
		start: z
			.number()
			.int()
			.min(0)
			.optional()
			.default(0)
			.describe("Pagination offset (default: 0)."),
	},
} as const;

type BitbucketBuildStatus = {
	state: "SUCCESSFUL" | "FAILED" | "INPROGRESS" | "UNKNOWN";
	key: string;
	name?: string;
	url: string;
	description?: string;
	dateAdded: number;
};

type BitbucketBuildStatusResponse = {
	values: BitbucketBuildStatus[];
	isLastPage: boolean;
	nextPageStart?: number;
};

export function bitbucketGetBuildStatusTool(server: McpServer): void {
	const schema = bitbucketGetBuildStatusSchema;
	server.tool(
		schema.name,
		schema.description,
		schema.args,
		async ({ commitId, limit, start }) => {
			const env = getBitbucketEnv();
			if (isBitbucketEnvError(env)) return env;
			const { baseUrl, token } = env;

			const params = new URLSearchParams({
				start: String(start),
				limit: String(limit),
			});

			const url = `${baseUrl}/rest/build-status/1.0/commits/${encodeURIComponent(commitId)}?${params}`;
			logger.log(`[mcp-bitbucket] GET ${url}`);

			try {
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

				const page = (await response.json()) as BitbucketBuildStatusResponse;
				const statuses = page.values.map((s) => ({
					state: s.state,
					key: s.key,
					name: s.name,
					url: s.url,
					description: s.description,
					dateAdded: s.dateAdded,
				}));

				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify(
								{
									statuses,
									isLastPage: page.isLastPage,
									nextPageStart: page.nextPageStart,
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
								error: `Failed to fetch build status: ${error instanceof Error ? error.message : "Unknown error"}`,
							}),
						},
					],
					isError: true,
				};
			}
		},
	);
}
