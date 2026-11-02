import { schema } from "prosemirror-schema-basic";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";

/** A real ProseMirror editor — the editor family behind several AI chat interfaces. */
const view = new EditorView(document.getElementById("editor")!, {
  state: EditorState.create({ schema }),
  dispatchTransaction(tr) {
    view.updateState(view.state.apply(tr));
    // Mirror the editor's *model* (not the DOM) so tests verify the editor really accepted the text.
    document.getElementById("state")!.textContent = view.state.doc.textBetween(0, view.state.doc.content.size, "\n");
  },
});
(window as unknown as { __pmText: () => string }).__pmText = () => view.state.doc.textBetween(0, view.state.doc.content.size, "\n");
