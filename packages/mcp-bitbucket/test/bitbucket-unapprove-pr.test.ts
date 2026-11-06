import { describe, expect, it, vi } from "vitest";
import { bitbucketUnapprovePrTool } from "../src/tools/bitbucket-unapprove-pr";
import { captureTool } from "./helpers/capture-tool";
import { TEST_BASE_URL, useBitbucketEnv } from "./helpers/env";

useBitbucketEnv();

describe("bitbucket_unapprove_pr", () => {
	it("resets the calling user's review status to UNAPPROVED", async () => {
		process.env.BITBUCKET_USER_SLUG = "jdoe";
		const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
			if (init?.method === undefined) {
				// fetchPrVersion's GET
				expect(url).toBe(
					`${TEST_BASE_URL}/rest/api/latest/projects/MLS/repos/ai-training/pull-requests/4337`,
				);
				return new Response(JSON.stringify({ version: 7 }), { status: 200 });
			}
			expect(url).toBe(
				`${TEST_BASE_URL}/rest/api/latest/projects/MLS/repos/ai-training/pull-requests/4337/participants/jdoe`,
			);
			expect(init.method).toBe("PUT");
			expect(JSON.parse(init.body as string)).toEqual({
				status: "UNAPPROVED",
				user: { slug: "jdoe" },
				version: 7,
			});
			return new Response(JSON.stringify({ status: "UNAPPROVED" }), {
				status: 200,
			});
		});
		vi.stubGlobal("fetch", fetchMock);

		const { handler } = captureTool(bitbucketUnapprovePrTool);
		const result = await handler({
			projectKey: "MLS",
			repositorySlug: "ai-training",
			pullRequestId: 4337,
		});

		expect(fetchMock).toHaveBeenCalledTimes(2);
		const data = JSON.parse(result.content[0].text);
		expect(data.status).toBe("UNAPPROVED");

		vi.unstubAllGlobals();
		delete process.env.BITBUCKET_USER_SLUG;
	});
});
