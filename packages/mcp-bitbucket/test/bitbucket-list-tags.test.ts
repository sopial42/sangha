import { describe, expect, it, vi } from "vitest";
import { bitbucketListTagsTool } from "../src/tools/bitbucket-list-tags";
import { captureTool } from "./helpers/capture-tool";
import { TEST_BASE_URL, useBitbucketEnv } from "./helpers/env";

useBitbucketEnv();

describe("bitbucket_list_tags", () => {
	it("lists tags in a repo", async () => {
		const fetchMock = vi.fn(async (url: string) => {
			expect(url).toBe(
				`${TEST_BASE_URL}/rest/api/1.0/projects/MLS/repos/ai-training/tags?start=0&limit=25`,
			);
			return new Response(
				JSON.stringify({
					values: [
						{ id: "refs/tags/v1.0.0", displayId: "v1.0.0", latestCommit: "abc" },
					],
					isLastPage: true,
				}),
				{ status: 200 },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const { handler } = captureTool(bitbucketListTagsTool);
		const result = await handler({
			projectKey: "MLS",
			repositorySlug: "ai-training",
		});

		const data = JSON.parse(result.content[0].text);
		expect(data.tags).toEqual([
			{ id: "refs/tags/v1.0.0", displayId: "v1.0.0", latestCommit: "abc" },
		]);

		vi.unstubAllGlobals();
	});
});
