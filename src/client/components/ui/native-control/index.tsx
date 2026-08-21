import {
	Button as ExpoButton,
	Host as ExpoHost,
	List as ExpoList,
	ListItem as ExpoListItem,
	Row as ExpoRow,
} from "@expo/ui";
import type { ComponentProps, ReactNode } from "react";
import { withUniwind } from "uniwind";

import { useAppTheme } from "../../../features/settings/ThemeProvider.tsx";

const StyledExpoHost = withUniwind(ExpoHost);

type NativeControlHostProps = Omit<
	ComponentProps<typeof ExpoHost>,
	"colorScheme" | "seedColor" | "style"
> & {
	className?: string;
	minimumHeight?: number;
};

function NativeControlHost({
	children,
	className,
	minimumHeight,
	...props
}: NativeControlHostProps) {
	const { resolvedTheme } = useAppTheme();

	return (
		<StyledExpoHost
			className={className}
			colorScheme={resolvedTheme}
			seedColorClassName="accent-primary"
			style={minimumHeight === undefined ? undefined : { minHeight: minimumHeight }}
			{...props}
		>
			{children}
		</StyledExpoHost>
	);
}

type NativeHostedButtonProps = Pick<
	ComponentProps<typeof ExpoButton>,
	"disabled" | "label" | "onPress" | "testID" | "variant"
>;

function NativeHostedButton(props: NativeHostedButtonProps) {
	return (
		<NativeControlHost matchContents>
			<ExpoRow spacing={8}>
				<ExpoButton {...props} />
			</ExpoRow>
		</NativeControlHost>
	);
}

interface NativeHostedListProps {
	children?: ReactNode;
	minimumHeight: number;
	testID?: string;
}

function NativeHostedList({ children, minimumHeight, testID }: NativeHostedListProps) {
	return (
		<NativeControlHost className="w-full" minimumHeight={minimumHeight} useViewportSizeMeasurement>
			<ExpoList testID={testID}>{children}</ExpoList>
		</NativeControlHost>
	);
}

type NativeHostedListItemProps = Pick<
	ComponentProps<typeof ExpoListItem>,
	"children" | "onPress" | "supportingText" | "testID"
>;

function NativeHostedListItem(props: NativeHostedListItemProps) {
	return <ExpoListItem {...props} />;
}

export {
	NativeControlHost,
	type NativeControlHostProps,
	NativeHostedButton,
	type NativeHostedButtonProps,
	NativeHostedList,
	NativeHostedListItem,
	type NativeHostedListItemProps,
	type NativeHostedListProps,
};
