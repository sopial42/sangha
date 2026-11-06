import { describe, expect, it, vi } from "vitest";
import { bitbucketAddPrCommentTool } from "../src/tools/bitbucket-add-pr-comment";
import { captureTool } from "./helpers/capture-tool";
import { TEST_BASE_URL, useBitbucketEnv } from "./helpers/env";

useBitbucketEnv();

const COMMENTS_URL = `${TEST_BASE_URL}/rest/api/latest/projects/MLS/repos/ai-training/pull-requests/4337/comments`;

describe("bitbucket_add_pr_comment", () => {
	it("posts a top-level comment with no anchor or parent by default", async () => {
		const fetchMock = vi.fn(
			async () => new Response(JSON.stringify({ id: 1 }), { status: 200 }),
		);
		vi.stubGlobal("fetch", fetchMock);

		const { handler } = captureTool(bitbucketAddPrCommentTool);
		const result = await handler({
			projectKey: "MLS",
			repositorySlug: "ai-training",
			pullRequestId: 4337,
			text: "Looks good",
		});

		expect(result.isError).toBeFalsy();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(COMMENTS_URL);
		expect(JSON.parse(init.body as string)).toEqual({ text: "Looks good" });

		vi.unstubAllGlobals();
	});

	it("replies to an existing comment when parentCommentId is set", async () => {
		const fetchMock = vi.fn(
			async () => new Response(JSON.stringify({ id: 56 }), { status: 200 }),
		);
		vi.stubGlobal("fetch", fetchMock);

		const { handler } = captureTool(bitbucketAddPrCommentTool);
		const result = await handler({
			projectKey: "MLS",
			repositorySlug: "ai-training",
			pullRequestId: 4337,
			text: "Thanks!",
			parentCommentId: 55,
		});

		expect(result.isError).toBeFalsy();
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(COMMENTS_URL);
		expect(JSON.parse(init.body as string)).toEqual({
			text: "Thanks!",
			parent: { id: 55 },
		});

		vi.unstubAllGlobals();
	});
});
