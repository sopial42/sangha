import { describe, expect, it, vi } from "vitest";
import { bitbucketListReposTool } from "../src/tools/bitbucket-list-repos";
import { captureTool } from "./helpers/capture-tool";
import { TEST_BASE_URL, useBitbucketEnv } from "./helpers/env";

useBitbucketEnv();

describe("bitbucket_list_repos", () => {
	it("lists repos in a project, filtered by name", async () => {
		const fetchMock = vi.fn(async (url: string) => {
			expect(url).toBe(
				`${TEST_BASE_URL}/rest/api/1.0/projects/MLS/repos?start=0&limit=25&name=ai`,
			);
			return new Response(
				JSON.stringify({
					values: [
						{
							slug: "ai-training",
							name: "ai-training",
							public: false,
							project: { key: "MLS" },
							links: { self: [{ href: "https://stash.ovh.net/x" }] },
						},
					],
					isLastPage: true,
				}),
				{ status: 200 },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const { handler } = captureTool(bitbucketListReposTool);
		const result = await handler({ projectKey: "MLS", name: "ai" });

		const data = JSON.parse(result.content[0].text);
		expect(data.repos).toEqual([
			{ slug: "ai-training", name: "ai-training", public: false },
		]);

		vi.unstubAllGlobals();
	});
});
