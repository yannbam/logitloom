import { type Token } from "./logit-loom";

export interface SerializedTree {
  isLogitLoomTreeVersion: "logit-loom-tree-v1";
  modelName: string;
  modelSettings:
    | {
        kind: "chat";
        systemPrompt?: string;
        prompt?: string;
        prefill?: string;
      }
    | {
        kind: "base";
        prompt?: string;
        prefill?: string;
      };
  roots: Token[];
}

export function saveTree(serialized: SerializedTree) {
  const jsonData = JSON.stringify(serialized, null, 2);

  const blob = new Blob([jsonData], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.style.display = "none";
  link.href = url;
  const date = new Date().toLocaleDateString("sv"); // iso format date, thank you sweden
  link.download = `logitloom-${serialized.modelName}-${date}.ll.json`;
  document.body.appendChild(link);
  link.click();

  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function loadTree(opts: {
  onDone: (tree: SerializedTree) => void;
  onError: (err: unknown) => void;
  onCancel: () => void;
}): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json";
  input.style.display = "none";

  const cleanup = () => {
    if (input.parentNode) document.body.removeChild(input);
  };

  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file == null) {
      cleanup();
      opts.onCancel();
      return;
    }

    const reader = new FileReader();

    reader.addEventListener("load", () => {
      try {
        // TODO: actually validate this
        const data = JSON.parse(reader.result as string);
        if ((data as SerializedTree).isLogitLoomTreeVersion === "logit-loom-tree-v1") {
          opts.onDone(data as SerializedTree);
        } else {
          console.error("loadTree: not a tree:", data);
          opts.onError(`File was not a logitloom tree.`);
        }
      } catch (err) {
        console.error("loadTree:", err);
        opts.onError(err);
      } finally {
        cleanup();
      }
    });

    reader.addEventListener("error", () => {
      console.error("loadTree:", reader.error);
      opts.onError(reader.error);
      cleanup();
    });

    reader.readAsText(file);
  });

  document.body.appendChild(input);
  input.click();
}
