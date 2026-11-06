import { describe, expect, it, vi } from "vitest";
import { bitbucketFindUserTool } from "../src/tools/bitbucket-find-user";
import { captureTool } from "./helpers/capture-tool";
import { TEST_BASE_URL, TEST_TOKEN, useBitbucketEnv } from "./helpers/env";

useBitbucketEnv();

describe("bitbucket_find_user", () => {
	it("searches users by filter and returns compact slugs", async () => {
		const fetchMock = vi.fn(async (url: string) => {
			expect(url).toBe(
				`${TEST_BASE_URL}/rest/api/1.0/users?filter=jdoe&start=0&limit=25`,
			);
			return new Response(
				JSON.stringify({
					values: [
						{
							slug: "jdoe",
							displayName: "Jane Doe",
							emailAddress: "jdoe@example.com",
							active: true,
						},
					],
					isLastPage: true,
				}),
				{ status: 200, headers: { Authorization: `Bearer ${TEST_TOKEN}` } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const { handler } = captureTool(bitbucketFindUserTool);
		const result = await handler({ query: "jdoe" });

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const data = JSON.parse(result.content[0].text);
		expect(data.users).toEqual([
			{
				slug: "jdoe",
				displayName: "Jane Doe",
				emailAddress: "jdoe@example.com",
				active: true,
			},
		]);
		expect(data.isLastPage).toBe(true);

		vi.unstubAllGlobals();
	});
});
