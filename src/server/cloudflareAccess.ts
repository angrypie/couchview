import type { RemoteBridgeOriginAccessProvider } from "./remoteBridgeOriginAccess.ts";

export const CLOUDFLARE_ORIGIN_ACCESS_PROVIDER_ID = "cloudflare-access";

export interface CloudflareAccessTokenOptions {
	allowLogin?: boolean;
}

export type CloudflareAccessTokenResolver = (
	origin: string,
	options?: CloudflareAccessTokenOptions,
) => Promise<string>;

async function readCloudflareAccessToken(
	cloudflared: string,
	origin: string,
): Promise<{ token: string; detail: string | undefined; valid: boolean }> {
	const child = Bun.spawn([cloudflared, "access", "token", `-app=${origin}`], {
		stdin: "inherit",
		stdout: "pipe",
		stderr: "pipe",
		timeout: 2 * 60_000,
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	const token = stdout.trim();
	return {
		token,
		detail: stderr.trim().split("\n")[0]?.slice(0, 240),
		valid: exitCode === 0 && Boolean(token) && token.length <= 32_768 && !/\s/.test(token),
	};
}

export async function cloudflareAccessToken(
	origin: string,
	options: CloudflareAccessTokenOptions = {},
): Promise<string> {
	const cloudflared = Bun.which("cloudflared");
	if (!cloudflared) {
		throw new Error(
			"cloudflared is required for this origin-access provider; install it and try again",
		);
	}
	let attempt = await readCloudflareAccessToken(cloudflared, origin);
	if (!attempt.valid && options.allowLogin) {
		process.stderr.write(
			`Cloudflare Access sign-in required for ${origin}. Complete it in the browser.\n`,
		);
		const login = Bun.spawn([cloudflared, "access", "login", "--quiet", origin], {
			stdin: "inherit",
			stdout: "inherit",
			stderr: "inherit",
			timeout: 5 * 60_000,
		});
		if ((await login.exited) !== 0) {
			throw new Error("Cloudflare Access login failed");
		}
		attempt = await readCloudflareAccessToken(cloudflared, origin);
	}
	if (!attempt.valid) {
		throw new Error(
			`Cloudflare Access authentication failed${attempt.detail ? `: ${attempt.detail}` : ""}`,
		);
	}
	return attempt.token;
}

export function cloudflareOriginAccessProvider(
	resolveToken: CloudflareAccessTokenResolver = cloudflareAccessToken,
): RemoteBridgeOriginAccessProvider {
	return {
		id: CLOUDFLARE_ORIGIN_ACCESS_PROVIDER_ID,
		createSession(origin) {
			let token: string | null = null;
			return {
				async requestHeaders(options = {}) {
					if (!token || options.refresh) {
						token = await resolveToken(origin, {
							allowLogin: options.interactive ?? false,
						});
					}
					return { "cf-access-token": token };
				},
			};
		},
	};
}
