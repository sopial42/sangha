import { describe, expect, it, vi } from "vitest";
import { bitbucketGetFileContentTool } from "../src/tools/bitbucket-get-file-content";
import { captureTool } from "./helpers/capture-tool";
import { TEST_BASE_URL, useBitbucketEnv } from "./helpers/env";

useBitbucketEnv();

describe("bitbucket_get_file_content", () => {
	it("fetches raw file content at a ref", async () => {
		const fetchMock = vi.fn(async (url: string) => {
			expect(url).toBe(
				`${TEST_BASE_URL}/rest/api/1.0/projects/MLS/repos/ai-training/raw/README.md?at=master`,
			);
			return new Response("# Hello\n", { status: 200 });
		});
		vi.stubGlobal("fetch", fetchMock);

		const { handler } = captureTool(bitbucketGetFileContentTool);
		const result = await handler({
			projectKey: "MLS",
			repositorySlug: "ai-training",
			filePath: "README.md",
			ref: "master",
		});

		const data = JSON.parse(result.content[0].text);
		expect(data.content).toBe("# Hello\n");
		expect(data.truncated).toBe(false);

		vi.unstubAllGlobals();
	});

	it("truncates content larger than maxBytes and says so", async () => {
		const big = "x".repeat(100);
		const fetchMock = vi.fn(async () => new Response(big, { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);

		const { handler } = captureTool(bitbucketGetFileContentTool);
		const result = await handler({
			projectKey: "MLS",
			repositorySlug: "ai-training",
			filePath: "big.txt",
			maxBytes: 10,
		});

		const data = JSON.parse(result.content[0].text);
		expect(data.content).toBe("x".repeat(10));
		expect(data.truncated).toBe(true);

		vi.unstubAllGlobals();
	});
});
