import type { Widget } from "../contracts/requests.js";
import {
  createConversation,
  type ConversationOptions,
  type ConversationRuntime,
} from "./runtime.js";

/** A renderer owns its DOM, styles and subscriptions, but never the runtime. */
export interface Presentation {
  mount(
    target: HTMLElement,
    runtime: ConversationRuntime,
  ): {
    update(config: Widget): void;
    dispose(): void;
  };
}
export interface MountedConversation extends ConversationRuntime {
  update(config: Partial<Widget>): void;
}
const appearance = new Set([
  "theme",
  "lang",
  "inputPosition",
  "reactionsEnabled",
  "emitMetadata",
]);
/** Renderer-independent lifecycle. This module imports no default UI or CSS. */
export function mountPresentation(
  target: HTMLElement,
  options: ConversationOptions,
  presentation: Presentation,
): MountedConversation {
  let current = { ...options, config: { ...options.config } };
  let runtime: ConversationRuntime,
    view: ReturnType<Presentation["mount"]>,
    disposed = false;
  const mount = () => {
    runtime = createConversation(current);
    view = presentation.mount(target, runtime);
  };
  mount();
  return {
    get config() {
      return runtime.config;
    },
    get interactions() {
      return runtime.interactions;
    },
    get controller() {
      return runtime.controller;
    },
    get session() {
      return runtime.session;
    },
    get renderContent() {
      return runtime.renderContent;
    },
    initialize(data) {
      runtime.initialize(data);
    },
    saveDrafts() {
      runtime.saveDrafts();
    },
    setFetching(value) {
      runtime.setFetching(value);
    },
    update(config) {
      if (disposed) throw new Error("Cannot update disposed comments.");
      if (Object.keys(config).every((key) => appearance.has(key))) {
        Object.assign(runtime.config, config);
        current.config = { ...runtime.config };
        view.update(runtime.config);
        return;
      }
      runtime.saveDrafts();
      view.dispose();
      runtime.dispose();
      current = { ...current, config: { ...current.config, ...config } };
      mount();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      runtime.saveDrafts();
      view.dispose();
      runtime.dispose();
    },
  };
}
