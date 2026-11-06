import { describe, expect, it, vi } from "vitest";
import { bitbucketListPrsTool } from "../src/tools/bitbucket-list-prs";
import { captureTool } from "./helpers/capture-tool";
import { TEST_BASE_URL, useBitbucketEnv } from "./helpers/env";

useBitbucketEnv();

describe("bitbucket_list_prs", () => {
	it("lists PRs in a repo with state/role/username filters", async () => {
		const fetchMock = vi.fn(async (url: string) => {
			expect(url).toBe(
				`${TEST_BASE_URL}/rest/api/1.0/projects/MLS/repos/ai-training/pull-requests?start=0&limit=25&state=OPEN&role.1=REVIEWER&username.1=jdoe`,
			);
			return new Response(
				JSON.stringify({
					values: [
						{
							id: 1,
							title: "Add feature",
							state: "OPEN",
							author: { user: { name: "author1" } },
							fromRef: { displayId: "feature/x" },
							toRef: { displayId: "master" },
							updatedDate: 1700000000000,
						},
					],
					isLastPage: true,
				}),
				{ status: 200 },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const { handler } = captureTool(bitbucketListPrsTool);
		const result = await handler({
			projectKey: "MLS",
			repositorySlug: "ai-training",
			role: "REVIEWER",
			username: "jdoe",
		});

		const data = JSON.parse(result.content[0].text);
		expect(data.pullRequests).toEqual([
			{
				id: 1,
				title: "Add feature",
				state: "OPEN",
				author: "author1",
				fromRef: "feature/x",
				toRef: "master",
				updatedDate: 1700000000000,
			},
		]);

		vi.unstubAllGlobals();
	});
});
