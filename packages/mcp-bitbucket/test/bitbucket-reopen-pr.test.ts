import { describe, expect, it, vi } from "vitest";
import { bitbucketReopenPrTool } from "../src/tools/bitbucket-reopen-pr";
import { captureTool } from "./helpers/capture-tool";
import { TEST_BASE_URL, useBitbucketEnv } from "./helpers/env";

useBitbucketEnv();

describe("bitbucket_reopen_pr", () => {
	it("fetches the current version then reopens the PR", async () => {
		const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
			if (!init?.method) {
				expect(url).toBe(
					`${TEST_BASE_URL}/rest/api/latest/projects/MLS/repos/ai-training/pull-requests/4337`,
				);
				return new Response(JSON.stringify({ version: 2 }), { status: 200 });
			}
			expect(url).toBe(
				`${TEST_BASE_URL}/rest/api/latest/projects/MLS/repos/ai-training/pull-requests/4337/reopen?version=2`,
			);
			expect(init.method).toBe("POST");
			return new Response(JSON.stringify({ state: "OPEN" }), { status: 200 });
		});
		vi.stubGlobal("fetch", fetchMock);

		const { handler } = captureTool(bitbucketReopenPrTool);
		const result = await handler({
			projectKey: "MLS",
			repositorySlug: "ai-training",
			pullRequestId: 4337,
		});

		const data = JSON.parse(result.content[0].text);
		expect(data.state).toBe("OPEN");

		vi.unstubAllGlobals();
	});
});
