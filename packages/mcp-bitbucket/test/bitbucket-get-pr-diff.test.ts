import { describe, expect, it, vi } from "vitest";
import { bitbucketGetPrDiffTool } from "../src/tools/bitbucket-get-pr-diff";
import { captureTool } from "./helpers/capture-tool";
import { TEST_BASE_URL, useBitbucketEnv } from "./helpers/env";

useBitbucketEnv();

describe("bitbucket_get_pr_diff", () => {
	it("flattens a hunk's added/removed/context lines with line numbers and sides", async () => {
		const fetchMock = vi.fn(async (url: string) => {
			expect(url).toBe(
				`${TEST_BASE_URL}/rest/api/latest/projects/MLS/repos/ai-training/pull-requests/4337/diff/src/foo.ts?contextLines=10`,
			);
			return new Response(
				JSON.stringify({
					truncated: false,
					diffs: [
						{
							destination: { toString: "src/foo.ts" },
							truncated: false,
							hunks: [
								{
									truncated: false,
									segments: [
										{
											type: "REMOVED",
											truncated: false,
											lines: [
												{ source: 5, destination: 0, line: "old", truncated: false },
											],
										},
										{
											type: "ADDED",
											truncated: false,
											lines: [
												{ source: 0, destination: 5, line: "new", truncated: false },
											],
										},
									],
								},
							],
						},
					],
				}),
				{ status: 200 },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const { handler } = captureTool(bitbucketGetPrDiffTool);
		const result = await handler({
			projectKey: "MLS",
			repositorySlug: "ai-training",
			pullRequestId: 4337,
			filePath: "src/foo.ts",
		});

		const data = JSON.parse(result.content[0].text);
		expect(data.truncated).toBe(false);
		expect(data.files).toEqual([
			{
				path: "src/foo.ts",
				truncated: false,
				lines: [
					{ lineNumber: 5, fileType: "FROM", lineType: "REMOVED", content: "old" },
					{ lineNumber: 5, fileType: "TO", lineType: "ADDED", content: "new" },
				],
			},
		]);

		vi.unstubAllGlobals();
	});
});
