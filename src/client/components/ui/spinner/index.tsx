import { ActivityIndicator, type ActivityIndicatorProps } from "react-native";

const spinnerColorClass = {
	destructive: "accent-destructive",
	foreground: "accent-foreground",
	muted: "accent-muted-foreground",
	primary: "accent-primary",
	success: "accent-success",
	warning: "accent-warning",
} as const;

type SpinnerProps = Omit<ActivityIndicatorProps, "color"> & {
	tone?: keyof typeof spinnerColorClass;
};

function Spinner({ accessibilityLabel = "Loading", tone = "primary", ...props }: SpinnerProps) {
	return (
		<ActivityIndicator
			accessibilityLabel={accessibilityLabel}
			accessibilityRole="progressbar"
			colorClassName={spinnerColorClass[tone]}
			{...props}
		/>
	);
}

export { Spinner, type SpinnerProps };
