export interface NativeServerProfile {
	id: string;
	name: string;
	baseUrl: string;
	serverId: string;
	lastInstanceId: string | null;
	lastRepositoryId: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface NativePairingDescriptor {
	baseUrl: string;
	serverId: string;
	code: string;
	expiresAt: string;
}
