import { Alert } from "react-native";

export function confirmAction(message: string, title = "Couchview"): Promise<boolean> {
	return new Promise((resolve) => {
		Alert.alert(title, message, [
			{ style: "cancel", text: "Cancel", onPress: () => resolve(false) },
			{ style: "destructive", text: "Continue", onPress: () => resolve(true) },
		]);
	});
}
