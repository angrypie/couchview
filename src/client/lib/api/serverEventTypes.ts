export interface ServerEventMessage {
	data: string;
	event: string;
	lastEventId: string;
}

export interface ServerEventHandlers {
	onError?: (error: unknown) => void;
	onMessage: (message: ServerEventMessage) => void;
	onOpen?: () => void;
}

export interface ServerEventSubscription {
	close(): void;
}
