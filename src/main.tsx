import "./styles/paper.css";
import "@fontsource/klee-one/400.css";
import "@fontsource/klee-one/600.css";
import "@fontsource/zen-kurenaido/400.css";
import "./styles/app.css";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import { boot } from "./ui/store";

boot();
createRoot(document.getElementById("root")!).render(<App />);
