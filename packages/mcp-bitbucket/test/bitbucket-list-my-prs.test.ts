import { describe, expect, it, vi } from "vitest";
import { bitbucketListMyPrsTool } from "../src/tools/bitbucket-list-my-prs";
import { captureTool } from "./helpers/capture-tool";
import { TEST_BASE_URL, useBitbucketEnv } from "./helpers/env";

useBitbucketEnv();

describe("bitbucket_list_my_prs", () => {
	it("lists the dashboard PRs for the calling user, filtered by role/state", async () => {
		const fetchMock = vi.fn(async (url: string) => {
			expect(url).toBe(
				`${TEST_BASE_URL}/rest/api/1.0/dashboard/pull-requests?start=0&limit=25&state=OPEN&role=REVIEWER`,
			);
			return new Response(
				JSON.stringify({
					values: [
						{
							id: 1,
							title: "Add feature",
							state: "OPEN",
							author: { user: { name: "author1" } },
							toRef: { displayId: "master", repository: { slug: "ai-training", project: { key: "MLS" } } },
							updatedDate: 1700000000000,
						},
					],
					isLastPage: true,
				}),
				{ status: 200 },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const { handler } = captureTool(bitbucketListMyPrsTool);
		const result = await handler({ role: "REVIEWER" });

		const data = JSON.parse(result.content[0].text);
		expect(data.pullRequests).toEqual([
			{
				id: 1,
				title: "Add feature",
				state: "OPEN",
				author: "author1",
				repo: "MLS/ai-training",
				toRef: "master",
				updatedDate: 1700000000000,
			},
		]);

		vi.unstubAllGlobals();
	});
});
