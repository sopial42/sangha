import { describe, expect, it, vi } from "vitest";
import { bitbucketResolvePrCommentTool } from "../src/tools/bitbucket-resolve-pr-comment";
import { captureTool } from "./helpers/capture-tool";
import { TEST_BASE_URL, useBitbucketEnv } from "./helpers/env";

useBitbucketEnv();

const COMMENT_URL = `${TEST_BASE_URL}/rest/api/latest/projects/MLS/repos/ai-training/pull-requests/4337/comments/55`;

describe("bitbucket_resolve_pr_comment", () => {
	it("defaults to RESOLVED and preserves the comment's text/severity", async () => {
		const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
			if (!init?.method) {
				expect(url).toBe(COMMENT_URL);
				return new Response(
					JSON.stringify({
						id: 55,
						version: 2,
						text: "please fix",
						severity: "BLOCKER",
						state: "OPEN",
						author: { name: "jdoe" },
					}),
					{ status: 200 },
				);
			}
			expect(init.method).toBe("PUT");
			expect(JSON.parse(init.body as string)).toEqual({
				text: "please fix",
				severity: "BLOCKER",
				state: "RESOLVED",
				version: 2,
			});
			return new Response(
				JSON.stringify({ id: 55, version: 3, state: "RESOLVED" }),
				{ status: 200 },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const { handler } = captureTool(bitbucketResolvePrCommentTool);
		const result = await handler({
			projectKey: "MLS",
			repositorySlug: "ai-training",
			pullRequestId: 4337,
			commentId: 55,
		});

		const data = JSON.parse(result.content[0].text);
		expect(data.state).toBe("RESOLVED");

		vi.unstubAllGlobals();
	});

	it("reopens a resolved thread when state is set to OPEN", async () => {
		const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
			if (!init?.method) {
				return new Response(
					JSON.stringify({
						id: 55,
						version: 3,
						text: "please fix",
						severity: "NORMAL",
						state: "RESOLVED",
						author: { name: "jdoe" },
					}),
					{ status: 200 },
				);
			}
			return new Response(JSON.stringify({ id: 55, state: "OPEN" }), {
				status: 200,
			});
		});
		vi.stubGlobal("fetch", fetchMock);

		const { handler } = captureTool(bitbucketResolvePrCommentTool);
		const result = await handler({
			projectKey: "MLS",
			repositorySlug: "ai-training",
			pullRequestId: 4337,
			commentId: 55,
			state: "OPEN",
		});

		expect(result.isError).toBeFalsy();
		const [, putInit] = fetchMock.mock.calls[1] as [string, RequestInit];
		expect(JSON.parse(putInit.body as string).state).toBe("OPEN");

		vi.unstubAllGlobals();
	});
});
