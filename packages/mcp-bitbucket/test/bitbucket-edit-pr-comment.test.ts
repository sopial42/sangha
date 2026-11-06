import { describe, expect, it, vi } from "vitest";
import { bitbucketEditPrCommentTool } from "../src/tools/bitbucket-edit-pr-comment";
import { captureTool } from "./helpers/capture-tool";
import { TEST_BASE_URL, useBitbucketEnv } from "./helpers/env";

useBitbucketEnv();

const COMMENT_URL = `${TEST_BASE_URL}/rest/api/latest/projects/MLS/repos/ai-training/pull-requests/4337/comments/55`;

describe("bitbucket_edit_pr_comment", () => {
	it("fetches the comment for its version, then PUTs the new text preserving severity/state", async () => {
		const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
			if (!init?.method) {
				expect(url).toBe(COMMENT_URL);
				return new Response(
					JSON.stringify({
						id: 55,
						version: 2,
						text: "old text",
						severity: "BLOCKER",
						state: "OPEN",
						author: { name: "jdoe" },
					}),
					{ status: 200 },
				);
			}
			expect(url).toBe(COMMENT_URL);
			expect(init.method).toBe("PUT");
			expect(JSON.parse(init.body as string)).toEqual({
				text: "new text",
				severity: "BLOCKER",
				state: "OPEN",
				version: 2,
			});
			return new Response(
				JSON.stringify({ id: 55, version: 3, text: "new text" }),
				{ status: 200 },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const { handler } = captureTool(bitbucketEditPrCommentTool);
		const result = await handler({
			projectKey: "MLS",
			repositorySlug: "ai-training",
			pullRequestId: 4337,
			commentId: 55,
			text: "new text",
		});

		expect(fetchMock).toHaveBeenCalledTimes(2);
		const data = JSON.parse(result.content[0].text);
		expect(data.version).toBe(3);
		expect(data.text).toBe("new text");

		vi.unstubAllGlobals();
	});
});
