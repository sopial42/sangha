// Shared parsing for Bitbucket Data Center's structured diff JSON, returned
// both by a pull request's `/diff/{path}` endpoint and a repository's
// `/compare/diff` / `/compare/diff/{path}` endpoints — same shape.

export type BitbucketDiffLine = {
	source: number;
	destination: number;
	line: string;
	truncated: boolean;
};

export type BitbucketSegment = {
	type: "ADDED" | "REMOVED" | "CONTEXT";
	lines: BitbucketDiffLine[];
	truncated: boolean;
};

export type BitbucketHunk = {
	segments: BitbucketSegment[];
	truncated: boolean;
};

export type BitbucketFileDiff = {
	source?: { toString: string };
	destination?: { toString: string };
	hunks: BitbucketHunk[];
	truncated: boolean;
};

export type BitbucketDiffResponse = {
	diffs: BitbucketFileDiff[];
	truncated: boolean;
};

export type DiffLine = {
	lineNumber: number;
	fileType: "FROM" | "TO";
	lineType: "ADDED" | "REMOVED" | "CONTEXT";
	content: string;
};

export type FileDiff = {
	path: string;
	lines: DiffLine[];
	truncated: boolean;
};

export function parseDiff(raw: BitbucketDiffResponse): {
	files: FileDiff[];
	truncated: boolean;
} {
	let anyTruncated = raw.truncated;

	const files = raw.diffs.map((fileDiff) => {
		const path =
			fileDiff.destination?.toString ?? fileDiff.source?.toString ?? "(unknown)";
		const lines: DiffLine[] = [];
		let fileTruncated = fileDiff.truncated;

		for (const hunk of fileDiff.hunks) {
			if (hunk.truncated) fileTruncated = true;
			for (const segment of hunk.segments) {
				if (segment.truncated) fileTruncated = true;
				for (const line of segment.lines) {
					if (line.truncated) fileTruncated = true;
					if (segment.type === "REMOVED") {
						lines.push({
							lineNumber: line.source,
							fileType: "FROM",
							lineType: "REMOVED",
							content: line.line,
						});
					} else {
						// ADDED or CONTEXT — both live in the destination file
						lines.push({
							lineNumber: line.destination,
							fileType: "TO",
							lineType: segment.type,
							content: line.line,
						});
					}
				}
			}
		}

		if (fileTruncated) anyTruncated = true;
		return { path, lines, truncated: fileTruncated };
	});

	return { files, truncated: anyTruncated };
}
