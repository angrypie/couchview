import { useLocalSearchParams } from "expo-router";
import { useEffect } from "react";

import { useNativeServer } from "../features/nativeServers/NativeServerProvider.tsx";
import { ProductRoot } from "./ProductRoot.tsx";

export function ReviewRoute() {
	const { repo } = useLocalSearchParams<{ repo?: string }>();
	const { workspace } = useNativeServer();
	const { repositories, repositoryId, selectRepository } = workspace;
	useEffect(() => {
		if (
			typeof repo === "string" &&
			repo !== repositoryId &&
			repositories.some(({ id, available }) => id === repo && available)
		) {
			void selectRepository(repo);
		}
	}, [repo, repositories, repositoryId, selectRepository]);
	return <ProductRoot mode="review" />;
}
