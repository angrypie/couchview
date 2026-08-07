export type KvStoreListener = () => void;

export interface KvStore {
	get(key: string): Promise<string | null>;
	set(key: string, value: string): Promise<void>;
	delete(key: string): Promise<void>;
	subscribe(key: string, listener: KvStoreListener): () => void;
}

export interface DisposableKvStore extends KvStore {
	close(): Promise<void>;
}
