export const fixtureCsrfToken = "e2e-csrf-token";

export const fixtureSecurityHeaders = {
	"Content-Security-Policy":
		"default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'",
	"Referrer-Policy": "no-referrer",
	"X-Content-Type-Options": "nosniff",
};

export function fixtureJson(value: unknown, status = 200): Response {
	return Response.json(value, {
		status,
		headers: {
			...fixtureSecurityHeaders,
			"Cache-Control": "no-store",
		},
	});
}

export function requireFixtureCsrf(request: Request): Response | null {
	return request.headers.get("x-couchview-csrf") === fixtureCsrfToken
		? null
		: fixtureJson({ error: { code: "invalid_csrf", message: "Invalid CSRF token" } }, 403);
}
