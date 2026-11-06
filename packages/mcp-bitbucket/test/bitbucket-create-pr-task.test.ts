import { describe, expect, it, vi } from "vitest";
import { bitbucketCreatePrTaskTool } from "../src/tools/bitbucket-create-pr-task";
import { captureTool } from "./helpers/capture-tool";
import { TEST_BASE_URL, useBitbucketEnv } from "./helpers/env";

useBitbucketEnv();

describe("bitbucket_create_pr_task", () => {
	it("posts a blocker comment (severity BLOCKER) as a task", async () => {
		const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
			expect(url).toBe(
				`${TEST_BASE_URL}/rest/api/latest/projects/MLS/repos/ai-training/pull-requests/4337/comments`,
			);
			expect(init?.method).toBe("POST");
			expect(JSON.parse(init?.body as string)).toEqual({
				text: "Fix this before merging",
				severity: "BLOCKER",
			});
			return new Response(
				JSON.stringify({ id: 99, severity: "BLOCKER", state: "OPEN" }),
				{ status: 200 },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const { handler } = captureTool(bitbucketCreatePrTaskTool);
		const result = await handler({
			projectKey: "MLS",
			repositorySlug: "ai-training",
			pullRequestId: 4337,
			text: "Fix this before merging",
		});

		const data = JSON.parse(result.content[0].text);
		expect(data.id).toBe(99);
		expect(data.severity).toBe("BLOCKER");

		vi.unstubAllGlobals();
	});

	it("supports anchoring the task to a file/line like a regular inline comment", async () => {
		const fetchMock = vi.fn(
			async () => new Response(JSON.stringify({ id: 100 }), { status: 200 }),
		);
		vi.stubGlobal("fetch", fetchMock);

		const { handler } = captureTool(bitbucketCreatePrTaskTool);
		const result = await handler({
			projectKey: "MLS",
			repositorySlug: "ai-training",
			pullRequestId: 4337,
			text: "Needs a null check",
			filePath: "src/foo.ts",
			line: 10,
		});

		expect(result.isError).toBeFalsy();
		const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		const body = JSON.parse(init.body as string);
		expect(body.anchor).toEqual({
			line: 10,
			lineType: "ADDED",
			fileType: "TO",
			path: "src/foo.ts",
		});

		vi.unstubAllGlobals();
	});
});
