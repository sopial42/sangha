const isStdio = process.env.MCP_TRANSPORT === "stdio";

export const logger = {
	log: (...args: unknown[]) =>
		isStdio ? console.error(...args) : console.log(...args),
	error: (...args: unknown[]) => console.error(...args),
};
