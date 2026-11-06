import { describe, expect, it, vi } from "vitest";
import { bitbucketGetBuildStatusTool } from "../src/tools/bitbucket-get-build-status";
import { captureTool } from "./helpers/capture-tool";
import { TEST_BASE_URL, useBitbucketEnv } from "./helpers/env";

useBitbucketEnv();

describe("bitbucket_get_build_status", () => {
	it("fetches build statuses for a commit", async () => {
		const fetchMock = vi.fn(async (url: string) => {
			expect(url).toBe(
				`${TEST_BASE_URL}/rest/build-status/1.0/commits/abc123?start=0&limit=25`,
			);
			return new Response(
				JSON.stringify({
					values: [
						{
							state: "SUCCESSFUL",
							key: "build-1",
							name: "CI",
							url: "https://ci.example.com/1",
							dateAdded: 1700000000000,
						},
					],
					isLastPage: true,
				}),
				{ status: 200 },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const { handler } = captureTool(bitbucketGetBuildStatusTool);
		const result = await handler({ commitId: "abc123" });

		const data = JSON.parse(result.content[0].text);
		expect(data.statuses).toEqual([
			{
				state: "SUCCESSFUL",
				key: "build-1",
				name: "CI",
				url: "https://ci.example.com/1",
				dateAdded: 1700000000000,
			},
		]);

		vi.unstubAllGlobals();
	});
});
