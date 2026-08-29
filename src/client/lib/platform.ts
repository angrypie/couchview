export function isApplePlatform(
	navigatorValue: Navigator | undefined = typeof navigator === "undefined" ? undefined : navigator,
): boolean {
	if (!navigatorValue) return false;
	const userAgentData = (
		navigatorValue as Navigator & {
			userAgentData?: { platform?: string };
		}
	).userAgentData;
	const platform = userAgentData?.platform || navigatorValue.platform || navigatorValue.userAgent;
	return /Mac|iPhone|iPad|iPod/i.test(platform);
}
