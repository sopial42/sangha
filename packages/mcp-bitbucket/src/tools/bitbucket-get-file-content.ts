import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getBitbucketEnv, isBitbucketEnvError } from "../lib/bitbucket";
import { logger } from "../logger";

const DEFAULT_MAX_BYTES = 100_000;

export const bitbucketGetFileContentSchema = {
	name: "bitbucket_get_file_content",
	description:
		"Fetch the raw text content of a file at a given ref in a Bitbucket Data Center repository. Large files are truncated (see `truncated` in the response) — narrow down with a more specific ref or read the file in chunks via an external tool if you need the full content.",
	args: {
		projectKey: z.string().describe('Bitbucket project key (e.g. "MYPROJ")'),
		repositorySlug: z.string().describe('Repository slug (e.g. "my-repo")'),
		filePath: z.string().min(1).describe('File path (e.g. "src/foo.ts").'),
		ref: z
			.string()
			.optional()
			.describe(
				'Branch, tag, or commit to read from (e.g. "master"). Defaults to the repository\'s default branch.',
			),
		maxBytes: z
			.number()
			.int()
			.positive()
			.optional()
			.default(DEFAULT_MAX_BYTES)
			.describe(
				`Maximum number of characters to return before truncating (default: ${DEFAULT_MAX_BYTES}).`,
			),
	},
} as const;

export function bitbucketGetFileContentTool(server: McpServer): void {
	const schema = bitbucketGetFileContentSchema;
	server.tool(
		schema.name,
		schema.description,
		schema.args,
		async ({ projectKey, repositorySlug, filePath, ref, maxBytes }) => {
			const env = getBitbucketEnv();
			if (isBitbucketEnvError(env)) return env;
			const { baseUrl, token } = env;

			const encodedFilePath = filePath
				.split("/")
				.map(encodeURIComponent)
				.join("/");
			const params = new URLSearchParams();
			if (ref) params.set("at", ref);
			const query = params.toString();

			const url = `${baseUrl}/rest/api/1.0/projects/${encodeURIComponent(projectKey)}/repos/${encodeURIComponent(repositorySlug)}/raw/${encodedFilePath}${query ? `?${query}` : ""}`;
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

				const fullContent = await response.text();
				const truncated = fullContent.length > maxBytes;
				const content = truncated ? fullContent.slice(0, maxBytes) : fullContent;

				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify(
								{
									path: filePath,
									ref: ref ?? "(default branch)",
									totalLength: fullContent.length,
									truncated,
									...(truncated && {
										truncationWarning: `File content truncated to ${maxBytes} characters (actual size: ${fullContent.length}).`,
									}),
									content,
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
								error: `Failed to fetch file content: ${error instanceof Error ? error.message : "Unknown error"}`,
							}),
						},
					],
					isError: true,
				};
			}
		},
	);
}
