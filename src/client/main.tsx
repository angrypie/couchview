import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { PierreWorkerProvider } from "./PierreWorkerProvider.tsx";
import "./styles.css";

const root = document.getElementById("root");

if (!root) throw new Error("Missing #root mount point");

createRoot(root).render(
	<StrictMode>
		<PierreWorkerProvider>
			<App />
		</PierreWorkerProvider>
	</StrictMode>,
);
