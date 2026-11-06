import { describe, expect, it, vi } from "vitest";
import { bitbucketListBranchesTool } from "../src/tools/bitbucket-list-branches";
import { captureTool } from "./helpers/capture-tool";
import { TEST_BASE_URL, useBitbucketEnv } from "./helpers/env";

useBitbucketEnv();

describe("bitbucket_list_branches", () => {
	it("lists branches filtered by text, flagging the default branch", async () => {
		const fetchMock = vi.fn(async (url: string) => {
			expect(url).toBe(
				`${TEST_BASE_URL}/rest/api/1.0/projects/MLS/repos/ai-training/branches?start=0&limit=25&filterText=master`,
			);
			return new Response(
				JSON.stringify({
					values: [
						{
							id: "refs/heads/master",
							displayId: "master",
							latestCommit: "abc123",
							isDefault: true,
						},
					],
					isLastPage: true,
				}),
				{ status: 200 },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const { handler } = captureTool(bitbucketListBranchesTool);
		const result = await handler({
			projectKey: "MLS",
			repositorySlug: "ai-training",
			filterText: "master",
		});

		const data = JSON.parse(result.content[0].text);
		expect(data.branches).toEqual([
			{
				id: "refs/heads/master",
				displayId: "master",
				latestCommit: "abc123",
				isDefault: true,
			},
		]);

		vi.unstubAllGlobals();
	});
});
