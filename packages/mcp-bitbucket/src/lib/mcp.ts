// ── Generic MCP response helpers ─────────────────────────────────────────────

export type McpErrorResponse = {
	content: [{ type: "text"; text: string }];
	isError: true;
};

export function errorResponse(message: string): McpErrorResponse {
	return {
		content: [{ type: "text", text: JSON.stringify({ error: message }) }],
		isError: true,
	};
}
