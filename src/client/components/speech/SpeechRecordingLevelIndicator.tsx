import { useEffect } from "react";
import type { ViewStyle } from "react-native";
import { View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import type { SpeechLevelSource } from "../../features/speech/index.ts";

const LEVEL_ANIMATION_DURATION_MS = 64;

export const speechRecordingWaveformClassName =
	"pointer-events-none relative h-5 w-6 items-center justify-center";

const waveformBars = [
	"h-2 w-0.5 rounded-full bg-destructive/70",
	"h-4 w-0.5 rounded-full bg-destructive/70",
	"h-2.5 w-0.5 rounded-full bg-destructive/70",
	"h-4 w-0.5 rounded-full bg-destructive/70",
	"h-2 w-0.5 rounded-full bg-destructive/70",
] as const;

export function speechRecordingWaveformStyle(level: number, reducedMotion = false): ViewStyle {
	"worklet";
	if (reducedMotion) {
		return { opacity: 0.55, transform: [{ scaleY: 0.55 }] };
	}
	const boundedLevel = Math.max(0, Math.min(1, level));
	return {
		opacity: 0.3 + boundedLevel * 0.65,
		transform: [{ scaleY: 0.25 + boundedLevel * 0.75 }],
	};
}

interface SpeechRecordingLevelIndicatorProps {
	level: SpeechLevelSource;
	reducedMotion: boolean;
}

export function SpeechRecordingLevelIndicator({
	level,
	reducedMotion,
}: SpeechRecordingLevelIndicatorProps) {
	const animatedLevel = useSharedValue(0);
	const animatedStyle = useAnimatedStyle(() =>
		speechRecordingWaveformStyle(animatedLevel.value, reducedMotion),
	);

	useEffect(() => {
		if (reducedMotion) {
			animatedLevel.value = 0;
			return;
		}
		const unsubscribe = level.subscribe((nextLevel) => {
			animatedLevel.value = withTiming(nextLevel, { duration: LEVEL_ANIMATION_DURATION_MS });
		});
		return () => {
			unsubscribe();
			animatedLevel.value = 0;
		};
	}, [animatedLevel, level, reducedMotion]);

	return (
		<View className={speechRecordingWaveformClassName}>
			<Animated.View
				accessibilityElementsHidden
				accessible={false}
				className="absolute flex-row items-center gap-0.5"
				style={animatedStyle}
				testID="speech-recording-waveform"
			>
				{waveformBars.map((className, index) => (
					<View className={className} key={`${className}-${index}`} />
				))}
			</Animated.View>
			<View className="absolute h-1.5 w-1.5 rounded-[1px] bg-destructive" />
		</View>
	);
}
