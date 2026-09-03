import { mock } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ComponentProps, ReactNode } from "react";
import React from "react";

if (!GlobalRegistrator.isRegistered) {
	GlobalRegistrator.register({ url: "http://127.0.0.1:4173/" });
}

const ReactNativeWeb = await import("react-native-web");
const openedUrls: string[] = [];

mock.module("react-native", () => ({
	...ReactNativeWeb,
	AccessibilityInfo: {
		...ReactNativeWeb.AccessibilityInfo,
		addEventListener: () => ({ remove() {} }),
		isReduceMotionEnabled: async () => false,
	},
	Linking: {
		...ReactNativeWeb.Linking,
		openURL: async (url: string) => {
			openedUrls.push(url);
			return true;
		},
	},
}));

function NullIcon() {
	return null;
}

mock.module("lucide-react-native", () => ({
	AlertTriangle: NullIcon,
	Archive: NullIcon,
	ArchiveRestore: NullIcon,
	ArrowLeft: NullIcon,
	Check: NullIcon,
	CheckCircle2: NullIcon,
	ChevronDown: NullIcon,
	ChevronLeft: NullIcon,
	ChevronRight: NullIcon,
	ChevronUp: NullIcon,
	Circle: NullIcon,
	CircleAlert: NullIcon,
	Copy: NullIcon,
	Download: NullIcon,
	ExternalLink: NullIcon,
	FileCode2: NullIcon,
	Folder: NullIcon,
	FolderGit2: NullIcon,
	FolderOpen: NullIcon,
	GitBranch: NullIcon,
	GitCommitHorizontal: NullIcon,
	GitGraph: NullIcon,
	GitPullRequestArrow: NullIcon,
	History: NullIcon,
	Laptop: NullIcon,
	ListFilter: NullIcon,
	ListTree: NullIcon,
	Link2: NullIcon,
	LoaderCircle: NullIcon,
	LogIn: NullIcon,
	Menu: NullIcon,
	Mic: NullIcon,
	Minus: NullIcon,
	MonitorUp: NullIcon,
	MoreHorizontal: NullIcon,
	MoveUp: NullIcon,
	Pencil: NullIcon,
	Play: NullIcon,
	Plus: NullIcon,
	RefreshCw: NullIcon,
	RotateCcw: NullIcon,
	Save: NullIcon,
	Search: NullIcon,
	Settings2: NullIcon,
	ShieldCheck: NullIcon,
	Smartphone: NullIcon,
	Sparkles: NullIcon,
	Square: NullIcon,
	SquareTerminal: NullIcon,
	TerminalSquare: NullIcon,
	Trash2: NullIcon,
	Undo2: NullIcon,
	WifiOff: NullIcon,
	WrapText: NullIcon,
	X: NullIcon,
}));

const ZERO_INSETS = { bottom: 0, left: 0, right: 0, top: 0 };
const TEST_FRAME = { height: 768, width: 1024, x: 0, y: 0 };

function SafeAreaProvider({ children }: { children?: ReactNode }) {
	return children;
}

function SafeAreaListener({
	children,
	onChange,
}: {
	children?: ReactNode;
	onChange?(metrics: { frame: typeof TEST_FRAME; insets: typeof ZERO_INSETS }): void;
}) {
	React.useEffect(() => {
		onChange?.({ frame: TEST_FRAME, insets: ZERO_INSETS });
	}, [onChange]);
	return children;
}

mock.module("react-native-safe-area-context", () => ({
	SafeAreaListener,
	SafeAreaProvider,
	SafeAreaView: ReactNativeWeb.View,
	initialWindowMetrics: { frame: TEST_FRAME, insets: ZERO_INSETS },
	useSafeAreaFrame: () => TEST_FRAME,
	useSafeAreaInsets: () => ZERO_INSETS,
}));

type SliderTestProps = {
	"aria-valuemax"?: number;
	"aria-valuemin"?: number;
	"aria-valuenow"?: number;
	accessibilityLabel?: string;
	accessibilityValue?: { max?: number; min?: number; now?: number; text?: string };
	disabled?: boolean;
	maximumTrackTintColorClassName?: string;
	maximumValue?: number;
	minimumTrackTintColorClassName?: string;
	minimumValue?: number;
	onSlidingComplete?(value: number): void;
	onSlidingStart?(value: number): void;
	onValueChange?(value: number): void;
	step?: number;
	testID?: string;
	thumbTintColorClassName?: string;
	value?: number;
};

const Slider = React.forwardRef<HTMLInputElement, SliderTestProps>(function Slider(
	{
		"aria-valuemax": ariaValueMax,
		"aria-valuemin": ariaValueMin,
		"aria-valuenow": ariaValueNow,
		accessibilityLabel,
		accessibilityValue,
		disabled,
		maximumTrackTintColorClassName,
		maximumValue,
		minimumTrackTintColorClassName,
		minimumValue,
		onSlidingComplete,
		onSlidingStart,
		onValueChange,
		step,
		testID,
		thumbTintColorClassName,
		value,
	},
	ref,
) {
	return (
		<input
			aria-label={accessibilityLabel}
			aria-valuemax={ariaValueMax}
			aria-valuemin={ariaValueMin}
			aria-valuenow={ariaValueNow}
			aria-valuetext={accessibilityValue?.text}
			data-accessibility-max={accessibilityValue?.max}
			data-accessibility-min={accessibilityValue?.min}
			data-accessibility-now={accessibilityValue?.now}
			data-maximum-track-class={maximumTrackTintColorClassName}
			data-minimum-track-class={minimumTrackTintColorClassName}
			data-testid={testID}
			data-thumb-class={thumbTintColorClassName}
			disabled={disabled}
			max={maximumValue}
			min={minimumValue}
			onChange={(event) => onValueChange?.(Number(event.currentTarget.value))}
			onPointerDown={(event) => onSlidingStart?.(Number(event.currentTarget.value))}
			onPointerUp={(event) => onSlidingComplete?.(Number(event.currentTarget.value))}
			ref={ref}
			step={step}
			type="range"
			value={value}
		/>
	);
});

mock.module("@react-native-community/slider", () => ({ default: Slider }));

function Svg({ children, ...props }: ComponentProps<"svg">) {
	return <svg {...props}>{children}</svg>;
}

const svgElements = {
	Circle: (props: ComponentProps<"circle">) => <circle {...props} />,
	Defs: (props: ComponentProps<"defs">) => <defs {...props} />,
	Ellipse: (props: ComponentProps<"ellipse">) => <ellipse {...props} />,
	G: (props: ComponentProps<"g">) => <g {...props} />,
	Line: (props: ComponentProps<"line">) => <line {...props} />,
	Path: (props: ComponentProps<"path">) => <path {...props} />,
	Polygon: (props: ComponentProps<"polygon">) => <polygon {...props} />,
	Polyline: (props: ComponentProps<"polyline">) => <polyline {...props} />,
	Rect: (props: ComponentProps<"rect">) => <rect {...props} />,
};

mock.module("react-native-svg", () => ({
	default: Svg,
	...svgElements,
	Svg,
}));

mock.module("expo-clipboard", () => ({
	setStringAsync: async (text: string) => {
		if (!navigator.clipboard?.writeText) return false;
		await navigator.clipboard.writeText(text);
		return true;
	},
}));

mock.module("expo-haptics", () => ({
	AndroidHaptics: {
		Confirm: "confirm",
		Reject: "reject",
		Toggle_Off: "toggle-off",
		Toggle_On: "toggle-on",
	},
	ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
	NotificationFeedbackType: { Error: "error", Success: "success" },
	impactAsync: async () => undefined,
	notificationAsync: async () => undefined,
	performAndroidHapticsAsync: async () => undefined,
}));

mock.module("expo-blob", () => ({ Blob: globalThis.Blob }));

mock.module("react-native-reanimated", () => ({
	default: { View: ReactNativeWeb.View },
	useAnimatedStyle: (factory: () => object) => factory(),
	useSharedValue: <Value,>(value: Value) => ({ value }),
	withTiming: <Value,>(value: Value) => value,
}));

export const nativeTestRuntime = {
	get openedUrls(): readonly string[] {
		return openedUrls;
	},
	reset() {
		openedUrls.length = 0;
	},
};

mock.module("expo-linking", () => ({
	createURL: (path: string) => new URL(path, window.location.origin).href,
	openURL: async (url: string) => {
		openedUrls.push(url);
		return true;
	},
}));
