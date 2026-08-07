import type { LucideIcon } from "lucide-react-native";
import type { SvgProps } from "react-native-svg";
import { useResolveClassNames } from "uniwind";

const iconToneClass = {
	accent: "text-accent-foreground",
	destructive: "text-destructive",
	"destructive-foreground": "text-destructive-foreground",
	foreground: "text-foreground",
	muted: "text-muted-foreground",
	primary: "text-primary",
	"primary-foreground": "text-primary-foreground",
	"secondary-foreground": "text-secondary-foreground",
	success: "text-success",
	"success-foreground": "text-success-foreground",
	warning: "text-warning",
	"warning-foreground": "text-warning-foreground",
} as const;

type IconTone = keyof typeof iconToneClass;

type IconProps = Omit<SvgProps, "color" | "height" | "width"> & {
	as: LucideIcon;
	color?: string;
	size?: number;
	strokeWidth?: number;
	tone?: IconTone;
};

function Icon({
	as: Glyph,
	color: colorOverride,
	size = 20,
	strokeWidth = 2,
	tone = "foreground",
	...props
}: IconProps) {
	const { color } = useResolveClassNames(iconToneClass[tone]);

	return <Glyph color={colorOverride ?? color} size={size} strokeWidth={strokeWidth} {...props} />;
}

export { Icon, type IconProps, type IconTone, type LucideIcon };
