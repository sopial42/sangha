import { describe, expect, it, vi } from "vitest";
import { bitbucketGetPrCommitsTool } from "../src/tools/bitbucket-get-pr-commits";
import { captureTool } from "./helpers/capture-tool";
import { TEST_BASE_URL, useBitbucketEnv } from "./helpers/env";

useBitbucketEnv();

describe("bitbucket_get_pr_commits", () => {
	it("lists commits on a pull request", async () => {
		const fetchMock = vi.fn(async (url: string) => {
			expect(url).toBe(
				`${TEST_BASE_URL}/rest/api/1.0/projects/MLS/repos/ai-training/pull-requests/4337/commits?start=0&limit=25`,
			);
			return new Response(
				JSON.stringify({
					values: [
						{
							id: "abc123def",
							displayId: "abc123d",
							author: { name: "jdoe" },
							authorTimestamp: 1700000000000,
							message: "Fix the thing\n\nBody",
						},
					],
					isLastPage: true,
				}),
				{ status: 200 },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const { handler } = captureTool(bitbucketGetPrCommitsTool);
		const result = await handler({
			projectKey: "MLS",
			repositorySlug: "ai-training",
			pullRequestId: 4337,
		});

		const data = JSON.parse(result.content[0].text);
		expect(data.commits).toEqual([
			{
				id: "abc123def",
				displayId: "abc123d",
				author: "jdoe",
				timestamp: 1700000000000,
				summary: "Fix the thing",
			},
		]);

		vi.unstubAllGlobals();
	});
});
