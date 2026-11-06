import { describe, expect, it, vi } from "vitest";
import { bitbucketGetPrActivitiesTool } from "../src/tools/bitbucket-get-pr-activities";
import { captureTool } from "./helpers/capture-tool";
import { TEST_BASE_URL, useBitbucketEnv } from "./helpers/env";

useBitbucketEnv();

describe("bitbucket_get_pr_activities", () => {
	it("flattens comment threads (with replies) and non-comment activities", async () => {
		const fetchMock = vi.fn(async (url: string) => {
			expect(url).toBe(
				`${TEST_BASE_URL}/rest/api/1.0/projects/MLS/repos/ai-training/pull-requests/4337/activities?start=0&limit=25`,
			);
			return new Response(
				JSON.stringify({
					values: [
						{
							id: 101,
							createdDate: 1700000000000,
							user: { name: "jdoe" },
							action: "COMMENTED",
							comment: {
								id: 55,
								version: 0,
								text: "Looks good",
								author: { name: "jdoe" },
								createdDate: 1700000000000,
								updatedDate: 1700000000000,
								severity: "NORMAL",
								state: "OPEN",
								anchor: {
									path: "src/x.ts",
									line: 10,
									lineType: "ADDED",
									fileType: "TO",
								},
								comments: [
									{
										id: 56,
										version: 0,
										text: "Thanks",
										author: { name: "bob" },
										createdDate: 1700000001000,
										updatedDate: 1700000001000,
										severity: "NORMAL",
										state: "OPEN",
										comments: [],
									},
								],
							},
						},
						{
							id: 102,
							createdDate: 1700000002000,
							user: { name: "bob" },
							action: "APPROVED",
						},
					],
					isLastPage: true,
				}),
				{ status: 200 },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const { handler } = captureTool(bitbucketGetPrActivitiesTool);
		const result = await handler({
			projectKey: "MLS",
			repositorySlug: "ai-training",
			pullRequestId: 4337,
		});

		const data = JSON.parse(result.content[0].text);
		expect(data.activities).toEqual([
			{
				type: "comment",
				id: 55,
				version: 0,
				author: "jdoe",
				text: "Looks good",
				createdDate: 1700000000000,
				updatedDate: 1700000000000,
				severity: "NORMAL",
				state: "OPEN",
				anchor: { path: "src/x.ts", line: 10, lineType: "ADDED", fileType: "TO" },
			},
			{
				type: "comment",
				id: 56,
				version: 0,
				author: "bob",
				text: "Thanks",
				createdDate: 1700000001000,
				updatedDate: 1700000001000,
				severity: "NORMAL",
				state: "OPEN",
				parentId: 55,
			},
			{ type: "APPROVED", user: "bob", date: 1700000002000 },
		]);

		vi.unstubAllGlobals();
	});
});
