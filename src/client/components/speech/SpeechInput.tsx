import { Check, CircleAlert, LoaderCircle, Mic } from "lucide-react-native";
import React, { type ReactNode, useEffect, useId, useRef } from "react";
import {
	type NativeSyntheticEvent,
	Pressable,
	type TextInputSelectionChangeEventData,
	View,
} from "react-native";
import Animated from "react-native-reanimated";

import { type SpeechPhase, type SpeechTarget, useSpeech } from "../../features/speech/index.ts";
import { Icon, Input, InputField, type InputFieldProps, Text } from "../ui";
import { SpeechRecordingLevelIndicator } from "./SpeechRecordingLevelIndicator.tsx";

export const speechButtonClassNames: Record<SpeechPhase, string> = {
	idle: "relative h-8 w-8 items-center justify-center rounded-full active:scale-95 transition-transform duration-100",
	requestingPermission:
		"relative h-8 w-8 items-center justify-center rounded-full bg-muted active:scale-95 transition-transform duration-100",
	recording:
		"relative h-8 w-8 items-center justify-center rounded-full bg-destructive/10 active:scale-95 transition-transform duration-100",
	transcribing:
		"relative h-8 w-8 items-center justify-center rounded-full bg-muted active:scale-95 transition-transform duration-100",
	error:
		"relative h-8 w-8 items-center justify-center rounded-full bg-destructive/10 active:scale-95 transition-transform duration-100",
};

export function speechIconClassName(phase: SpeechPhase, reducedMotion: boolean): string {
	if (reducedMotion) return "items-center justify-center";
	if (phase === "transcribing") {
		return "items-center justify-center animate-spin uw-entering-fade-in uw-exiting-fade-out duration-200";
	}
	return "items-center justify-center uw-entering-fade-in uw-exiting-fade-out duration-200";
}

interface SpeechButtonProps {
	disabled: boolean;
	target: SpeechTarget;
}

function phaseLabel(phase: SpeechPhase): string {
	if (phase === "requestingPermission") return "Cancel microphone permission request";
	if (phase === "recording") return "Stop dictation";
	if (phase === "transcribing") return "Cancel transcription";
	if (phase === "error") return "Retry dictation";
	return "Start dictation";
}

function SpeechButton({ disabled, target }: SpeechButtonProps) {
	const speech = useSpeech();
	const active = speech.targetId === target.id;
	const phase = active ? speech.phase : "idle";
	const outcome = speech.outcomeTargetId === target.id ? speech.outcome : null;
	if (!speech.available && !active) return null;
	const status =
		outcome === "success" ? "Transcript inserted" : outcome === "error" ? speech.error : null;
	return (
		<View className="relative h-8 w-8 shrink-0 items-center justify-center">
			<Pressable
				accessibilityLabel={status ?? phaseLabel(phase)}
				accessibilityRole="button"
				accessibilityState={{
					busy: phase === "requestingPermission" || phase === "transcribing",
					disabled,
				}}
				className={speechButtonClassNames[phase]}
				disabled={disabled}
				onPress={() => speech.toggle(target)}
				testID={`speech-button-${target.id}`}
			>
				<Animated.View
					className={speechIconClassName(phase, speech.reducedMotion)}
					key={outcome ?? phase}
				>
					{outcome === "success" ? (
						<Icon as={Check} size={17} tone="success" />
					) : outcome === "error" || phase === "error" ? (
						<Icon as={CircleAlert} size={17} tone="destructive" />
					) : phase === "recording" ? (
						<SpeechRecordingLevelIndicator
							level={speech.voiceLevel}
							reducedMotion={speech.reducedMotion}
						/>
					) : phase === "transcribing" || phase === "requestingPermission" ? (
						<Icon as={LoaderCircle} size={17} tone="muted" />
					) : (
						<Icon as={Mic} size={17} tone="muted" />
					)}
				</Animated.View>
			</Pressable>
			{active || outcome ? (
				<Text
					accessibilityLiveRegion="polite"
					className="pointer-events-none absolute h-px w-px overflow-hidden opacity-0"
				>
					{status ?? phaseLabel(phase)}
				</Text>
			) : null}
		</View>
	);
}

export interface SpeechInputProps extends Omit<InputFieldProps, "onChangeText" | "value"> {
	containerClassName?: string;
	isDisabled?: boolean;
	leading?: ReactNode;
	onChangeText(value: string): void;
	speechEnabled?: boolean;
	value: string;
}

type SpeechInputInstance = React.ComponentRef<typeof InputField>;

interface SpeechSelectionHandle {
	setNativeProps?(props: { selection: { start: number; end: number } }): void;
	setSelectionRange?(start: number, end: number): void;
}

function applySelection(
	handle: SpeechSelectionHandle | null,
	selection: { start: number; end: number },
): void {
	if (typeof handle?.setSelectionRange === "function") {
		const select = () => handle.setSelectionRange?.(selection.start, selection.end);
		if (typeof requestAnimationFrame === "function") requestAnimationFrame(select);
		else setTimeout(select, 0);
		return;
	}
	handle?.setNativeProps?.({ selection });
}

export const SpeechInput = React.forwardRef<SpeechInputInstance, SpeechInputProps>(
	function SpeechInput(
		{
			containerClassName,
			editable,
			isDisabled = false,
			leading,
			maxLength,
			onChangeText,
			onSelectionChange,
			speechEnabled = true,
			value,
			...props
		},
		forwardedRef,
	) {
		const id = useId();
		const speech = useSpeech();
		const inputRef = useRef<SpeechSelectionHandle | null>(null);
		const selectionRef = useRef({ start: value.length, end: value.length });
		const valueRef = useRef(value);
		valueRef.current = value;
		useEffect(() => () => speech.detachTarget(id), [id, speech.detachTarget]);

		const setRef = (node: SpeechInputInstance | null) => {
			inputRef.current = node as unknown as SpeechSelectionHandle | null;
			if (typeof forwardedRef === "function") forwardedRef(node);
			else if (forwardedRef) forwardedRef.current = node;
		};
		const target: SpeechTarget = {
			apply(nextValue, selection) {
				selectionRef.current = selection;
				onChangeText(nextValue);
				applySelection(inputRef.current, selection);
			},
			getSelection: () => selectionRef.current,
			getValue: () => valueRef.current,
			id,
			maxLength: typeof maxLength === "number" ? maxLength : undefined,
		};
		const handleSelection = (event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
			selectionRef.current = event.nativeEvent.selection;
			onSelectionChange?.(event);
		};
		const handleChangeText = (nextValue: string) => {
			const caret = nextValue.length;
			selectionRef.current = { start: caret, end: caret };
			onChangeText(nextValue);
		};
		return (
			<Input className={containerClassName} isDisabled={isDisabled}>
				{leading}
				<InputField
					{...props}
					editable={editable}
					maxLength={maxLength}
					onChangeText={handleChangeText}
					onSelectionChange={handleSelection}
					ref={setRef}
					value={value}
				/>
				{speechEnabled ? (
					<SpeechButton disabled={isDisabled || editable === false} target={target} />
				) : null}
			</Input>
		);
	},
);

SpeechInput.displayName = "SpeechInput";

export const SpeechTextArea = React.forwardRef<SpeechInputInstance, SpeechInputProps>(
	function SpeechTextArea({ containerClassName = "min-h-24 items-start py-1", ...props }, ref) {
		return (
			<SpeechInput
				className="min-h-20 py-2"
				containerClassName={containerClassName}
				multiline
				ref={ref}
				textAlignVertical="top"
				{...props}
			/>
		);
	},
);

SpeechTextArea.displayName = "SpeechTextArea";
