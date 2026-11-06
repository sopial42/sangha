import { describe, expect, it, vi } from "vitest";
import { bitbucketMergePrTool } from "../src/tools/bitbucket-merge-pr";
import { captureTool } from "./helpers/capture-tool";
import { TEST_BASE_URL, useBitbucketEnv } from "./helpers/env";

useBitbucketEnv();

const PR_URL = `${TEST_BASE_URL}/rest/api/1.0/projects/MLS/repos/ai-training/pull-requests/4337`;
const PR_VERSION_URL = `${TEST_BASE_URL}/rest/api/latest/projects/MLS/repos/ai-training/pull-requests/4337`;

describe("bitbucket_merge_pr", () => {
	it("refuses to merge and reports vetoes when the PR cannot be merged", async () => {
		const fetchMock = vi.fn(async (url: string) => {
			if (url === `${PR_URL}/merge`) {
				return new Response(
					JSON.stringify({
						canMerge: false,
						conflicted: false,
						vetoes: [{ summaryMessage: "Not enough approvals" }],
					}),
					{ status: 200 },
				);
			}
			throw new Error(`unexpected call to ${url}`);
		});
		vi.stubGlobal("fetch", fetchMock);

		const { handler } = captureTool(bitbucketMergePrTool);
		const result = await handler({
			projectKey: "MLS",
			repositorySlug: "ai-training",
			pullRequestId: 4337,
		});

		expect(result.isError).toBe(true);
		const data = JSON.parse(result.content[0].text);
		expect(data.vetoes).toEqual(["Not enough approvals"]);
		expect(fetchMock).toHaveBeenCalledTimes(1);

		vi.unstubAllGlobals();
	});

	it("fetches the version then posts the merge when mergeable", async () => {
		const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
			if (url === `${PR_URL}/merge`) {
				return new Response(
					JSON.stringify({ canMerge: true, conflicted: false, vetoes: [] }),
					{ status: 200 },
				);
			}
			if (url === PR_VERSION_URL && !init?.method) {
				return new Response(JSON.stringify({ version: 4 }), { status: 200 });
			}
			expect(url).toBe(`${PR_URL}/merge?version=4`);
			expect(init?.method).toBe("POST");
			expect(JSON.parse(init?.body as string)).toEqual({
				message: "Merging via agent",
			});
			return new Response(JSON.stringify({ state: "MERGED" }), { status: 200 });
		});
		vi.stubGlobal("fetch", fetchMock);

		const { handler } = captureTool(bitbucketMergePrTool);
		const result = await handler({
			projectKey: "MLS",
			repositorySlug: "ai-training",
			pullRequestId: 4337,
			message: "Merging via agent",
		});

		const data = JSON.parse(result.content[0].text);
		expect(data.state).toBe("MERGED");

		vi.unstubAllGlobals();
	});
});
