import { tva } from "@gluestack-ui/utils/nativewind-utils";
import NativeSlider, {
	type SliderProps as NativeSliderProps,
} from "@react-native-community/slider";
import { withUniwind } from "uniwind";

const StyledSlider = withUniwind(NativeSlider);

const sliderStyle = tva({
	base: "w-full",
	variants: { disabled: { true: "opacity-50" } },
});

type SliderProps = Omit<
	NativeSliderProps,
	"maximumTrackTintColor" | "minimumTrackTintColor" | "style" | "thumbTintColor"
> & {
	className?: string;
};

function Slider({
	accessibilityValue,
	className,
	disabled,
	maximumValue,
	minimumValue,
	value,
	...props
}: SliderProps) {
	return (
		<StyledSlider
			aria-valuemax={maximumValue}
			aria-valuemin={minimumValue}
			aria-valuenow={value}
			accessibilityRole="adjustable"
			accessibilityValue={
				accessibilityValue ?? { max: maximumValue, min: minimumValue, now: value }
			}
			className={sliderStyle({ class: className, disabled })}
			disabled={disabled}
			maximumValue={maximumValue}
			maximumTrackTintColorClassName="accent-border"
			minimumValue={minimumValue}
			minimumTrackTintColorClassName="accent-primary"
			thumbTintColorClassName="accent-primary"
			value={value}
			{...props}
		/>
	);
}

export { Slider, type SliderProps };
