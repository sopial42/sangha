import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, type ZodRawShape } from "zod";

export type CapturedTool = {
	name: string;
	description: string;
	args: ZodRawShape;
	// The real callback is typed against the zod args schema; tests pass plain
	// objects and read back the MCP-shaped { content, isError? } response.
	handler: (args: Record<string, unknown>) => Promise<{
		content: Array<{ type: "text"; text: string }>;
		isError?: boolean;
	}>;
};

/**
 * Registers `register` against a fake McpServer that just records the single
 * `server.tool(...)` call it makes, instead of a real SDK server. Lets tests
 * invoke a tool's handler directly and mock `fetch` around it.
 *
 * The raw args are parsed through the tool's zod schema first — same as the
 * real SDK does — so `.optional().default(...)` fields behave as they would
 * in production instead of coming through as `undefined`.
 */
export function captureTool(register: (server: McpServer) => void): CapturedTool {
	let captured: CapturedTool | undefined;
	const fakeServer = {
		tool: (
			name: string,
			description: string,
			args: ZodRawShape,
			handler: CapturedTool["handler"],
		) => {
			captured = { name, description, args, handler };
		},
	} as unknown as McpServer;

	register(fakeServer);
	if (!captured) throw new Error("tool was not registered");

	const { args, handler } = captured;
	const schema = z.object(args);
	return {
		...captured,
		// async wrapper: a validation error from schema.parse (e.g. a .refine()
		// failing) becomes a rejected promise instead of a synchronous throw,
		// which is how real callers (awaiting a tool call) would observe it.
		handler: async (raw) => handler(schema.parse(raw)),
	};
}
