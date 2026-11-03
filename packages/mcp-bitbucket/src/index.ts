import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
	type BitbucketCredentials,
	runWithCredentials,
} from "./lib/request-context";
import { logger } from "./logger";
import {
	bitbucketAddPrCommentTool,
	bitbucketApprovePrTool,
	bitbucketCreateBranchTool,
	bitbucketCreatePrTool,
	bitbucketDeclinePrTool,
	bitbucketFindTicketsInReleasePrsTool,
	bitbucketGetPrDiffTool,
	bitbucketGetPrFilesTool,
	bitbucketRequestChangesPrTool,
} from "./tools";

const PORT = parseInt(process.env.PORT || "3001", 10);

function header(req: IncomingMessage, name: string): string | undefined {
	const value = req.headers[name];
	return Array.isArray(value) ? value[0] : value;
}

/**
 * Extract per-user Bitbucket credentials from the request headers.
 * `X-Bitbucket-Token` is preferred; `Authorization: Bearer <pat>` is accepted
 * as a fallback. Each user sends their own PAT so actions are attributed to
 * the real person.
 */
function readCredentials(req: IncomingMessage): BitbucketCredentials {
	let token = header(req, "x-bitbucket-token");
	if (!token) {
		const auth = header(req, "authorization");
		if (auth?.startsWith("Bearer ")) token = auth.slice("Bearer ".length);
	}
	return { token, userSlug: header(req, "x-bitbucket-user-slug") };
}

function createMcpServer(): McpServer {
	const server = new McpServer({
		name: "bitbucket-mcp",
		version: "1.0.0",
	});
	bitbucketGetPrFilesTool(server);
	bitbucketGetPrDiffTool(server);
	bitbucketFindTicketsInReleasePrsTool(server);
	bitbucketAddPrCommentTool(server);
	bitbucketApprovePrTool(server);
	bitbucketRequestChangesPrTool(server);
	bitbucketDeclinePrTool(server);
	bitbucketCreateBranchTool(server);
	bitbucketCreatePrTool(server);
	return server;
}

async function startStdio(): Promise<void> {
	const server = createMcpServer();
	const transport = new StdioServerTransport();
	await server.connect(transport);
	logger.log("[mcp] stdio transport ready");
}

// Stateless mode: new server + transport per request
async function handleMcpRequest(
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	const server = createMcpServer();
	const transport = new StreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
	});
	await server.connect(transport);

	res.on("close", () => {
		transport.close();
		server.close();
	});

	await runWithCredentials(readCredentials(req), () =>
		transport.handleRequest(req, res),
	);
}

function startHttp(): void {
	const httpServer = createServer(async (req, res) => {
		if (req.url === "/health") {
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ status: "ok" }));
			return;
		}

		if (req.url === "/mcp") {
			try {
				await handleMcpRequest(req, res);
			} catch (err) {
				logger.error("MCP request error:", err);
				if (!res.headersSent) {
					res.writeHead(500, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ error: "Internal server error" }));
				}
			}
			return;
		}

		res.writeHead(404);
		res.end("Not found");
	});

	httpServer.listen(PORT, () => {
		logger.log(`MCP server listening on http://localhost:${PORT}/mcp`);
	});
}

if (process.env.MCP_TRANSPORT === "stdio") {
	startStdio();
} else {
	startHttp();
}
