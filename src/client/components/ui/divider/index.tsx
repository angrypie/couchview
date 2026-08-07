import { tva, type VariantProps } from "@gluestack-ui/utils/nativewind-utils";
import { View, type ViewProps } from "react-native";

const dividerStyle = tva({
	base: "bg-border",
	defaultVariants: { orientation: "horizontal" },
	variants: {
		orientation: {
			horizontal: "h-px w-full",
			vertical: "h-full w-px",
		},
	},
});

type DividerProps = ViewProps & VariantProps<typeof dividerStyle>;

function Divider({ className, orientation = "horizontal", ...props }: DividerProps) {
	return (
		<View
			accessibilityRole="none"
			className={dividerStyle({ class: className, orientation })}
			{...props}
		/>
	);
}

export { Divider, type DividerProps };
