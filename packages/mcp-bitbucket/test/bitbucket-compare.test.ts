import { describe, expect, it, vi } from "vitest";
import { bitbucketCompareTool } from "../src/tools/bitbucket-compare";
import { captureTool } from "./helpers/capture-tool";
import { TEST_BASE_URL, useBitbucketEnv } from "./helpers/env";

useBitbucketEnv();

const BASE = `${TEST_BASE_URL}/rest/api/1.0/projects/MLS/repos/ai-training`;

describe("bitbucket_compare", () => {
	it("compares commits between two refs by default", async () => {
		const fetchMock = vi.fn(async (url: string) => {
			expect(url).toBe(
				`${BASE}/compare/commits?start=0&limit=25&from=feature%2Fx&to=master`,
			);
			return new Response(
				JSON.stringify({
					values: [
						{
							id: "abc123def",
							displayId: "abc123d",
							author: { name: "jdoe" },
							authorTimestamp: 1700000000000,
							message: "Fix the thing\n\nBody",
						},
					],
					isLastPage: true,
				}),
				{ status: 200 },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const { handler } = captureTool(bitbucketCompareTool);
		const result = await handler({
			projectKey: "MLS",
			repositorySlug: "ai-training",
			fromRef: "feature/x",
			toRef: "master",
		});

		const data = JSON.parse(result.content[0].text);
		expect(data.commits).toEqual([
			{
				id: "abc123def",
				displayId: "abc123d",
				author: "jdoe",
				timestamp: 1700000000000,
				summary: "Fix the thing",
			},
		]);
		expect(data.changedFiles).toBeUndefined();
		expect(data.diff).toBeUndefined();

		vi.unstubAllGlobals();
	});

	it("also lists changed files when includeChangedFiles is set", async () => {
		const fetchMock = vi.fn(async (url: string) => {
			if (url.includes("/compare/commits")) {
				return new Response(
					JSON.stringify({ values: [], isLastPage: true }),
					{ status: 200 },
				);
			}
			expect(url).toBe(
				`${BASE}/compare/changes?start=0&limit=100&from=feature%2Fx&to=master`,
			);
			return new Response(
				JSON.stringify({
					values: [{ path: { toString: "src/foo.ts" }, type: "MODIFY" }],
					isLastPage: true,
				}),
				{ status: 200 },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const { handler } = captureTool(bitbucketCompareTool);
		const result = await handler({
			projectKey: "MLS",
			repositorySlug: "ai-training",
			fromRef: "feature/x",
			toRef: "master",
			includeChangedFiles: true,
		});

		const data = JSON.parse(result.content[0].text);
		expect(data.changedFiles).toEqual([{ path: "src/foo.ts", changeType: "MODIFY" }]);

		vi.unstubAllGlobals();
	});

	it("fetches the structured diff of a single file when filePath is set", async () => {
		const fetchMock = vi.fn(async (url: string) => {
			if (url.includes("/compare/commits")) {
				return new Response(
					JSON.stringify({ values: [], isLastPage: true }),
					{ status: 200 },
				);
			}
			expect(url).toBe(
				`${BASE}/compare/diff/src/foo.ts?from=feature%2Fx&to=master&contextLines=10`,
			);
			return new Response(
				JSON.stringify({
					truncated: false,
					diffs: [
						{
							destination: { toString: "src/foo.ts" },
							truncated: false,
							hunks: [
								{
									truncated: false,
									segments: [
										{
											type: "ADDED",
											truncated: false,
											lines: [
												{ source: 0, destination: 3, line: "new", truncated: false },
											],
										},
									],
								},
							],
						},
					],
				}),
				{ status: 200 },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const { handler } = captureTool(bitbucketCompareTool);
		const result = await handler({
			projectKey: "MLS",
			repositorySlug: "ai-training",
			fromRef: "feature/x",
			toRef: "master",
			filePath: "src/foo.ts",
		});

		const data = JSON.parse(result.content[0].text);
		expect(data.diff.files).toEqual([
			{
				path: "src/foo.ts",
				truncated: false,
				lines: [
					{ lineNumber: 3, fileType: "TO", lineType: "ADDED", content: "new" },
				],
			},
		]);

		vi.unstubAllGlobals();
	});
});
