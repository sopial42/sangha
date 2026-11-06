import { describe, expect, it, vi } from "vitest";
import { bitbucketListFilesTool } from "../src/tools/bitbucket-list-files";
import { captureTool } from "./helpers/capture-tool";
import { TEST_BASE_URL, useBitbucketEnv } from "./helpers/env";

useBitbucketEnv();

describe("bitbucket_list_files", () => {
	it("lists the contents of a directory at a ref", async () => {
		const fetchMock = vi.fn(async (url: string) => {
			expect(url).toBe(
				`${TEST_BASE_URL}/rest/api/1.0/projects/MLS/repos/ai-training/browse/src?start=0&limit=25&at=master`,
			);
			return new Response(
				JSON.stringify({
					children: {
						values: [
							{ path: { toString: "src/index.ts" }, type: "FILE" },
							{ path: { toString: "src/lib" }, type: "DIRECTORY" },
						],
						isLastPage: true,
					},
				}),
				{ status: 200 },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const { handler } = captureTool(bitbucketListFilesTool);
		const result = await handler({
			projectKey: "MLS",
			repositorySlug: "ai-training",
			path: "src",
			ref: "master",
		});

		const data = JSON.parse(result.content[0].text);
		expect(data.files).toEqual([
			{ path: "src/index.ts", type: "FILE" },
			{ path: "src/lib", type: "DIRECTORY" },
		]);

		vi.unstubAllGlobals();
	});

	it("browses the root when no path is given", async () => {
		const fetchMock = vi.fn(
			async () =>
				new Response(
					JSON.stringify({ children: { values: [], isLastPage: true } }),
					{ status: 200 },
				),
		);
		vi.stubGlobal("fetch", fetchMock);

		const { handler } = captureTool(bitbucketListFilesTool);
		const result = await handler({
			projectKey: "MLS",
			repositorySlug: "ai-training",
		});

		expect(result.isError).toBeFalsy();
		const [url] = fetchMock.mock.calls[0] as [string];
		expect(url).toBe(
			`${TEST_BASE_URL}/rest/api/1.0/projects/MLS/repos/ai-training/browse?start=0&limit=25`,
		);

		vi.unstubAllGlobals();
	});
});
