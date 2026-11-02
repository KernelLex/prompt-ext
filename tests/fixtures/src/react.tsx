import { useState } from "react";
import { createRoot } from "react-dom/client";

/** Controlled textarea: the DOM only changes through React state, like most chat UIs. */
function App() {
  const [value, setValue] = useState("");
  return (
    <form onSubmit={(e) => e.preventDefault()}>
      <textarea id="field" rows={6} cols={80} value={value} onChange={(e) => setValue(e.target.value)} />
      <pre id="state">{value}</pre>
      <button type="submit" data-send>Send</button>
    </form>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
