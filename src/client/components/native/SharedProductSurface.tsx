"use dom";

interface SharedProductSurfaceProps {
	dom?: import("expo/dom").DOMProps;
	onManageServers(): Promise<void>;
	onSurfaceReady(): Promise<void>;
}

export default function SharedProductSurface(_props: SharedProductSurfaceProps) {
	return (
		<main
			style={{
				alignItems: "center",
				background: "#0b0d10",
				color: "#e7edf5",
				display: "flex",
				font: "15px system-ui, sans-serif",
				height: "100vh",
				justifyContent: "center",
			}}
		>
			Opening Couchview…
		</main>
	);
}
