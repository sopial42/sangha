import { describe, expect, it, vi } from "vitest";
import { bitbucketGetPrTool } from "../src/tools/bitbucket-get-pr";
import { captureTool } from "./helpers/capture-tool";
import { TEST_BASE_URL, useBitbucketEnv } from "./helpers/env";

useBitbucketEnv();

const PR_URL = `${TEST_BASE_URL}/rest/api/1.0/projects/MLS/repos/ai-training/pull-requests/4337`;

describe("bitbucket_get_pr", () => {
	it("returns PR details merged with mergeability", async () => {
		const fetchMock = vi.fn(async (url: string) => {
			if (url === `${PR_URL}/merge`) {
				return new Response(
					JSON.stringify({ canMerge: false, conflicted: true, vetoes: [{ summaryMessage: "Needs approval" }] }),
					{ status: 200 },
				);
			}
			if (url === PR_URL) {
				return new Response(
					JSON.stringify({
						id: 4337,
						version: 3,
						title: "Add feature",
						description: "Does a thing",
						state: "OPEN",
						open: true,
						closed: false,
						author: { user: { displayName: "Jane Doe", name: "jdoe" } },
						reviewers: [
							{
								user: { displayName: "Bob", name: "bob" },
								approved: true,
								status: "APPROVED",
							},
						],
						fromRef: { displayId: "feature/x" },
						toRef: { displayId: "master" },
						createdDate: 1700000000000,
						updatedDate: 1700000001000,
						links: { self: [{ href: "https://stash.example.test/x" }] },
					}),
					{ status: 200 },
				);
			}
			throw new Error(`unexpected url ${url}`);
		});
		vi.stubGlobal("fetch", fetchMock);

		const { handler } = captureTool(bitbucketGetPrTool);
		const result = await handler({
			projectKey: "MLS",
			repositorySlug: "ai-training",
			pullRequestId: 4337,
		});

		const data = JSON.parse(result.content[0].text);
		expect(data.id).toBe(4337);
		expect(data.version).toBe(3);
		expect(data.title).toBe("Add feature");
		expect(data.author).toBe("jdoe");
		expect(data.reviewers).toEqual([
			{ user: "bob", approved: true, status: "APPROVED" },
		]);
		expect(data.fromRef).toBe("feature/x");
		expect(data.toRef).toBe("master");
		expect(data.url).toBe("https://stash.example.test/x");
		expect(data.mergeable).toEqual({
			canMerge: false,
			conflicted: true,
			vetoes: ["Needs approval"],
		});

		vi.unstubAllGlobals();
	});
});
