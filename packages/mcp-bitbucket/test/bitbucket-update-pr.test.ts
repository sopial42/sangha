import { describe, expect, it, vi } from "vitest";
import { bitbucketUpdatePrTool } from "../src/tools/bitbucket-update-pr";
import { captureTool } from "./helpers/capture-tool";
import { TEST_BASE_URL, useBitbucketEnv } from "./helpers/env";

useBitbucketEnv();

const PR_URL = `${TEST_BASE_URL}/rest/api/1.0/projects/MLS/repos/ai-training/pull-requests/4337`;

function currentPrResponse() {
	return new Response(
		JSON.stringify({
			id: 4337,
			version: 5,
			title: "Old title",
			description: "Old description",
			toRef: {
				id: "refs/heads/master",
				repository: { slug: "ai-training", project: { key: "MLS" } },
			},
			reviewers: [{ user: { name: "bob" } }],
		}),
		{ status: 200 },
	);
}

describe("bitbucket_update_pr", () => {
	it("changes only the title, preserving description/toRef/reviewers", async () => {
		const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
			if (!init?.method) {
				expect(url).toBe(PR_URL);
				return currentPrResponse();
			}
			expect(url).toBe(PR_URL);
			expect(init.method).toBe("PUT");
			expect(JSON.parse(init.body as string)).toEqual({
				version: 5,
				title: "New title",
				description: "Old description",
				toRef: {
					id: "refs/heads/master",
					repository: { slug: "ai-training", project: { key: "MLS" } },
				},
				reviewers: [{ user: { name: "bob" } }],
			});
			return new Response(JSON.stringify({ id: 4337, version: 6, title: "New title" }), {
				status: 200,
			});
		});
		vi.stubGlobal("fetch", fetchMock);

		const { handler } = captureTool(bitbucketUpdatePrTool);
		const result = await handler({
			projectKey: "MLS",
			repositorySlug: "ai-training",
			pullRequestId: 4337,
			title: "New title",
		});

		expect(fetchMock).toHaveBeenCalledTimes(2);
		const data = JSON.parse(result.content[0].text);
		expect(data.version).toBe(6);

		vi.unstubAllGlobals();
	});

	it("appends to the existing description with appendDescription", async () => {
		const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
			if (!init?.method) return currentPrResponse();
			return new Response(JSON.stringify({ id: 4337, version: 6 }), { status: 200 });
		});
		vi.stubGlobal("fetch", fetchMock);

		const { handler } = captureTool(bitbucketUpdatePrTool);
		const result = await handler({
			projectKey: "MLS",
			repositorySlug: "ai-training",
			pullRequestId: 4337,
			appendDescription: "More context",
		});

		expect(result.isError).toBeFalsy();
		const [, putInit] = fetchMock.mock.calls[1] as [string, RequestInit];
		const body = JSON.parse(putInit.body as string);
		expect(body.description).toBe("Old description\n\nMore context");

		vi.unstubAllGlobals();
	});

	it("adds reviewers to the existing list by default (reviewersMode add)", async () => {
		const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
			if (!init?.method) return currentPrResponse();
			return new Response(JSON.stringify({ id: 4337, version: 6 }), { status: 200 });
		});
		vi.stubGlobal("fetch", fetchMock);

		const { handler } = captureTool(bitbucketUpdatePrTool);
		const result = await handler({
			projectKey: "MLS",
			repositorySlug: "ai-training",
			pullRequestId: 4337,
			reviewers: ["alice"],
		});

		expect(result.isError).toBeFalsy();
		const [, putInit] = fetchMock.mock.calls[1] as [string, RequestInit];
		const body = JSON.parse(putInit.body as string);
		expect(body.reviewers).toEqual([
			{ user: { name: "bob" } },
			{ user: { name: "alice" } },
		]);

		vi.unstubAllGlobals();
	});

	it("replaces the reviewer list when reviewersMode is replace", async () => {
		const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
			if (!init?.method) return currentPrResponse();
			return new Response(JSON.stringify({ id: 4337, version: 6 }), { status: 200 });
		});
		vi.stubGlobal("fetch", fetchMock);

		const { handler } = captureTool(bitbucketUpdatePrTool);
		const result = await handler({
			projectKey: "MLS",
			repositorySlug: "ai-training",
			pullRequestId: 4337,
			reviewers: ["alice"],
			reviewersMode: "replace",
		});

		expect(result.isError).toBeFalsy();
		const [, putInit] = fetchMock.mock.calls[1] as [string, RequestInit];
		const body = JSON.parse(putInit.body as string);
		expect(body.reviewers).toEqual([{ user: { name: "alice" } }]);

		vi.unstubAllGlobals();
	});

	it("normalizes and changes the target branch", async () => {
		const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
			if (!init?.method) return currentPrResponse();
			return new Response(JSON.stringify({ id: 4337, version: 6 }), { status: 200 });
		});
		vi.stubGlobal("fetch", fetchMock);

		const { handler } = captureTool(bitbucketUpdatePrTool);
		const result = await handler({
			projectKey: "MLS",
			repositorySlug: "ai-training",
			pullRequestId: 4337,
			targetBranch: "develop",
		});

		expect(result.isError).toBeFalsy();
		const [, putInit] = fetchMock.mock.calls[1] as [string, RequestInit];
		const body = JSON.parse(putInit.body as string);
		expect(body.toRef).toEqual({
			id: "refs/heads/develop",
			repository: { slug: "ai-training", project: { key: "MLS" } },
		});

		vi.unstubAllGlobals();
	});

	it("errors without calling PUT when nothing to update was given", async () => {
		const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
			if (!init?.method) return currentPrResponse();
			throw new Error("should not PUT");
		});
		vi.stubGlobal("fetch", fetchMock);

		const { handler } = captureTool(bitbucketUpdatePrTool);
		const result = await handler({
			projectKey: "MLS",
			repositorySlug: "ai-training",
			pullRequestId: 4337,
		});

		expect(result.isError).toBe(true);
		vi.unstubAllGlobals();
	});

	it("rejects providing both description and appendDescription", async () => {
		const { handler } = captureTool(bitbucketUpdatePrTool);
		await expect(
			handler({
				projectKey: "MLS",
				repositorySlug: "ai-training",
				pullRequestId: 4337,
				description: "x",
				appendDescription: "y",
			}),
		).rejects.toThrow();
	});
});
