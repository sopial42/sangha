import { describe, expect, it, vi } from "vitest";
import { bitbucketListCommitsTool } from "../src/tools/bitbucket-list-commits";
import { captureTool } from "./helpers/capture-tool";
import { TEST_BASE_URL, useBitbucketEnv } from "./helpers/env";

useBitbucketEnv();

describe("bitbucket_list_commits", () => {
	it("lists commits on a ref, summarizing the message to its first line", async () => {
		const fetchMock = vi.fn(async (url: string) => {
			expect(url).toBe(
				`${TEST_BASE_URL}/rest/api/1.0/projects/MLS/repos/ai-training/commits?start=0&limit=25&until=master`,
			);
			return new Response(
				JSON.stringify({
					values: [
						{
							id: "abc123def",
							displayId: "abc123d",
							author: { name: "jdoe", emailAddress: "jdoe@example.com" },
							authorTimestamp: 1700000000000,
							message: "Fix the thing\n\nLonger body here.",
						},
					],
					isLastPage: true,
				}),
				{ status: 200 },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const { handler } = captureTool(bitbucketListCommitsTool);
		const result = await handler({
			projectKey: "MLS",
			repositorySlug: "ai-training",
			ref: "master",
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
