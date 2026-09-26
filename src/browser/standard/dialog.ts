import { element as h, button } from "../dom.js";
export type DialogField =
  | { name: string; label: string; value: string; kind: "text" | "multiline" }
  | {
      name: string;
      label: string;
      value: string;
      kind: "select";
      options: readonly { value: string; label: string }[];
    };
/** Standard presentation only. Custom renderers may use their own interaction. */
export function requestFields(
  host: HTMLElement,
  title: string,
  fields: readonly DialogField[],
  labels: { confirm: string; cancel: string },
): Promise<Record<string, string> | null> {
  return new Promise((resolve) => {
    const dialog = h("dialog", { class: "action-dialog", "aria-label": title });
    const form = h("form");
    form.append(h("h2", {}, title));
    const controls = new Map<
      string,
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >();
    for (const field of fields) {
      const control =
        field.kind === "select"
          ? h(
              "select",
              {},
              ...field.options.map((option) =>
                h("option", { value: option.value }, option.label),
              ),
            )
          : field.kind === "multiline"
            ? h("textarea", { rows: 8 })
            : h("input", { type: "text" });
      control.name = field.name;
      control.value = field.value;
      controls.set(field.name, control);
      form.append(h("label", {}, h("span", {}, field.label), control));
    }
    let settled = false;
    const finish = (value: Record<string, string> | null) => {
      if (settled) return;
      settled = true;
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    form.append(
      h(
        "div",
        { class: "dialog-actions" },
        button(labels.cancel, () => finish(null)),
        h("button", { type: "submit", class: "primary" }, labels.confirm),
      ),
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      finish(
        Object.fromEntries(
          [...controls].map(([name, control]) => [name, control.value]),
        ),
      );
    });
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(null);
    });
    dialog.append(form);
    host.append(dialog);
    dialog.showModal();
  });
}
