import { tva, type VariantProps } from "@gluestack-ui/utils/nativewind-utils";
import React from "react";
import { View, type ViewProps } from "react-native";

const toolbarStyle = tva({
	base: "min-h-12 flex-row items-center gap-2 bg-background px-3",
	defaultVariants: { placement: "inline" },
	variants: {
		placement: {
			bottom: "border-t border-border pb-safe",
			inline: "rounded-xl border border-border",
			top: "border-b border-border pt-safe",
		},
	},
});

type ToolbarProps = ViewProps & VariantProps<typeof toolbarStyle>;

const Toolbar = React.forwardRef<React.ComponentRef<typeof View>, ToolbarProps>(function Toolbar(
	{ className, placement = "inline", ...props },
	ref,
) {
	return (
		<View
			accessibilityRole="toolbar"
			className={toolbarStyle({ class: className, placement })}
			ref={ref}
			{...props}
		/>
	);
});

Toolbar.displayName = "Toolbar";

function ToolbarSpacer(props: ViewProps) {
	return <View className="flex-1" {...props} />;
}

export { Toolbar, type ToolbarProps, ToolbarSpacer };
