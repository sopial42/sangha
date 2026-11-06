import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getBitbucketEnv, isBitbucketEnvError } from "../lib/bitbucket";
import { logger } from "../logger";

export const bitbucketListFilesSchema = {
	name: "bitbucket_list_files",
	description:
		"List the contents (files and subdirectories) of a directory at a given ref in a Bitbucket Data Center repository. Use bitbucket_get_file_content to read a file's content.",
	args: {
		projectKey: z.string().describe('Bitbucket project key (e.g. "MYPROJ")'),
		repositorySlug: z.string().describe('Repository slug (e.g. "my-repo")'),
		path: z
			.string()
			.optional()
			.describe('Directory path to list (e.g. "src/lib"). Defaults to the repository root.'),
		ref: z
			.string()
			.optional()
			.describe(
				'Branch, tag, or commit to browse (e.g. "master"). Defaults to the repository\'s default branch.',
			),
		limit: z
			.number()
			.int()
			.positive()
			.max(200)
			.optional()
			.default(25)
			.describe("Max number of entries to return (default: 25)."),
		start: z
			.number()
			.int()
			.min(0)
			.optional()
			.default(0)
			.describe("Pagination offset (default: 0)."),
	},
} as const;

type BitbucketBrowseResponse = {
	children?: {
		values: Array<{ path: { toString: string }; type: "FILE" | "DIRECTORY" }>;
		isLastPage: boolean;
		nextPageStart?: number;
	};
};

export function bitbucketListFilesTool(server: McpServer): void {
	const schema = bitbucketListFilesSchema;
	server.tool(
		schema.name,
		schema.description,
		schema.args,
		async ({ projectKey, repositorySlug, path, ref, limit, start }) => {
			const env = getBitbucketEnv();
			if (isBitbucketEnvError(env)) return env;
			const { baseUrl, token } = env;

			const params = new URLSearchParams({
				start: String(start),
				limit: String(limit),
			});
			if (ref) params.set("at", ref);

			const encodedPath = path
				? `/${path.split("/").map(encodeURIComponent).join("/")}`
				: "";
			const url = `${baseUrl}/rest/api/1.0/projects/${encodeURIComponent(projectKey)}/repos/${encodeURIComponent(repositorySlug)}/browse${encodedPath}?${params}`;
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

				const raw = (await response.json()) as BitbucketBrowseResponse;
				const children = raw.children;
				if (!children) {
					return {
						content: [
							{
								type: "text" as const,
								text: JSON.stringify({
									error: `"${path ?? "(root)"}" is not a directory (or the API response had no "children" — did you pass a file path? Use bitbucket_get_file_content for files).`,
								}),
							},
						],
						isError: true,
					};
				}

				const files = children.values.map((entry) => ({
					path: entry.path.toString,
					type: entry.type,
				}));

				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify(
								{
									files,
									isLastPage: children.isLastPage,
									nextPageStart: children.nextPageStart,
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
								error: `Failed to list directory: ${error instanceof Error ? error.message : "Unknown error"}`,
							}),
						},
					],
					isError: true,
				};
			}
		},
	);
}
