import { useEffect, useRef } from "react";
import { Board } from "../render/board";
import { Guide, Hotbar, Title, Toasts, TopBar } from "./Hud";
import { Inspector } from "./Inspector";
import { Library } from "./Library";
import { Notes } from "./Notes";
import { Contracts, Help, Modal, Prestige, Research, Settings } from "./Panels";
import { useUi } from "./store";

function BoardHost() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const b = new Board();
    b.init(ref.current!);
    return () => b.destroy();
  }, []);
  return <div className="board" ref={ref} />;
}

export function App() {
  const ready = useUi((s) => s.ready);
  const hasGame = useUi((s) => s.hasGame);
  const meta = useUi((s) => s.meta);
  const panel = useUi((s) => s.panel);
  const dark = useUi((s) => s.dark);
  useEffect(() => {
    let saved = false;
    try {
      saved = localStorage.getItem("cfi-dark") === "1";
    } catch {
      /* 保存できない環境では既定のまま */
    }
    if (saved) useUi.setState({ dark: true });
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  if (!ready) return <div className="title">読み込み中…</div>;
  if (!hasGame) return <Title />;
  if (!meta) return <div className="title">読み込み中…</div>;
  return (
    <>
      <BoardHost />
      <TopBar />
      <Guide />
      <Inspector />
      <Hotbar />
      <Toasts />
      {panel && (
        <Modal>
          {panel === "contracts" && <Contracts />}
          {panel === "library" && <Library />}
          {panel === "research" && <Research />}
          {panel === "notes" && <Notes />}
          {panel === "settings" && <Settings />}
          {panel === "prestige" && <Prestige />}
          {panel === "help" && <Help />}
        </Modal>
      )}
    </>
  );
}
