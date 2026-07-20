export function parsePagination(url: URL): { page: number; limit: number; offset: number } {
	const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
	const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 20));
	const offset = (page - 1) * limit;
	return { page, limit, offset };
}
