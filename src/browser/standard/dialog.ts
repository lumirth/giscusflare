import { html, render, nothing } from "lit-html";
interface ReasonOptions {
  label: string;
  choices: readonly { value: string; label: string }[];
}
/** Confirm a comment action; hiding additionally requires a moderation reason. */
export function confirmAction(
  host: HTMLElement,
  title: string,
  labels: { confirm: string; cancel: string },
  signal: AbortSignal,
  reason?: ReasonOptions,
): Promise<string | null> {
  if (signal.aborted) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'action-dialog';dialog.setAttribute('aria-label', title);
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    const abort = () => finish(null);
    render(html`<form @submit=${(event: SubmitEvent) => {
      event.preventDefault();finish(dialog.querySelector('select')?.value ?? '');
    }}>
      <h2>${title}</h2>
      ${reason ? html`<label><span>${reason.label}</span><select name="reason">
        ${reason.choices.map(option => html`<option value=${option.value}>${option.label}</option>`)}
      </select></label>` : nothing}
      <div class="dialog-actions"><button type="button" @click=${abort}>${labels.cancel}</button>
        <button type="submit" class="primary">${labels.confirm}</button></div>
    </form>`, dialog);
    dialog.addEventListener("cancel", event => {
      event.preventDefault();
      abort();
    });
    signal.addEventListener("abort", abort, { once: true });
    try { host.append(dialog);dialog.showModal(); }
    catch (error) { reject(error);finish(null); }
  });
}
