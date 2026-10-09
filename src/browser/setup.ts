import { githubAppRegistration, configurationValues, sessionSecret } from './setup-values.js';
import { themes } from '../themes.js';
const form = document.getElementById('setup-form') as HTMLFormElement;
const statusNode = document.getElementById('setup-status')!;
const result = document.getElementById('setup-result')!;
const code = document.getElementById('setup-code')!;
const copyButton = document.getElementById('setup-copy')!;
const copyStatus = document.getElementById('copy-status')!;
const themeSelect=form.elements.namedItem('theme') as HTMLSelectElement;
for(const theme of themes)if(![...themeSelect.options].some(option=>option.value===theme))themeSelect.add(new Option(theme.replaceAll('_',' '),theme));
const mappingSelect = form.elements.namedItem('mapping') as HTMLSelectElement;
const termInput = form.elements.namedItem('term') as HTMLInputElement;
const termLabel = document.getElementById('mapping-value-label')!;
const escapeAttribute = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function updateMappingFields(): void {
  const mapping = mappingSelect.value;
  termInput.inputMode = mapping === 'number' ? 'numeric' : 'text';
  termLabel.textContent = mapping === 'number' ? 'Discussion number' : 'Exact page key';
}
mappingSelect.addEventListener('change', updateMappingFields);
updateMappingFields();

form.addEventListener('submit', event => {
  event.preventDefault();
  void (async () => {
    const submit = form.querySelector('button')!;
    submit.disabled = true;
    result.hidden = true;
    copyButton.textContent = 'Copy code';
    copyStatus.textContent = '';
    statusNode.textContent = 'Checking repository...';
    try {
      const values = new FormData(form);
      const repo = String(values.get('repo')).trim().toLowerCase();
      const origin = new URL(String(values.get('origin'))).origin;
      const mapping = String(values.get('mapping'));
      const term = String(values.get('term') || '').trim();
      const registration = String(values.get('registration') || '').trim();
      if (mapping === 'page' && !term) throw new Error('Enter an exact page key.');
      if (mapping === 'number' && !/^[1-9]\d*$/.test(term)) throw new Error('Enter a positive discussion number.');
      const response = await fetch('/api/v6/config?' + new URLSearchParams({ input: JSON.stringify({ repo, origin, ...(registration ? {registration} : {}) }) }), { cache: 'no-store' });
      const data = await response.json() as { repo: string; error?: { message: string } };
      if (!response.ok) throw new Error(data.error?.message || 'Could not check the repository.');
      const attributes: Record<string, string> = {
        src: location.origin + '/client.js',
        'data-repo': data.repo,
        ...(registration ? { 'data-registration': registration } : {}),
        ...(mapping === 'page' ? { 'data-page-key': term } : { 'data-discussion-number': term }),
        'data-reactions-enabled': '1',
        'data-input-position': String(values.get('position')), 'data-theme': String(values.get('theme')),
        'data-lang': 'en', crossorigin: 'anonymous',
      };
      code.textContent = '<script\n' + Object.entries(attributes).map(([key, value]) => `  ${key}="${escapeAttribute(value)}"`).join('\n') + '\n  async>\n</script>';
      result.hidden = false;
      statusNode.textContent = '';
    } catch (error) {
      statusNode.textContent = error instanceof Error ? error.message : 'Could not generate the embed code.';
    } finally {
      submit.disabled = false;
    }
  })();
});
copyButton.addEventListener('click', () => {
  void (async () => {
    try {
      await navigator.clipboard.writeText(code.textContent || '');
      copyButton.textContent = 'Copied';
      copyStatus.textContent = '';
    } catch {
      copyStatus.textContent = 'Select the code and copy it manually.';
    }
  })();
});
const appForm = document.getElementById('app-form') as HTMLFormElement;
const configurationForm = document.getElementById('configuration-form') as HTMLFormElement;
const input = (target: HTMLFormElement, name: string) => target.elements.namedItem(name) as HTMLInputElement;
appForm.addEventListener('submit', event => {
  event.preventDefault();
  try {
    const website = input(appForm, 'website').value;
    const link = document.getElementById('app-link') as HTMLAnchorElement;
    link.href = githubAppRegistration(location.origin, website);
    document.getElementById('app-link-row')!.hidden = false;
    document.getElementById('app-error')!.textContent = '';
    input(configurationForm, 'website').value = website;
    input(form, 'origin').value = website;
  } catch {
    document.getElementById('app-error')!.textContent = 'Enter your website address.';
  }
});
configurationForm.addEventListener('submit', event => {
  event.preventDefault();
  document.getElementById('configuration-result')!.hidden = true;
  try {
    const values = configurationValues(location.origin, input(configurationForm, 'repo').value.trim(), input(configurationForm, 'website').value, input(configurationForm, 'category').value.trim(), input(configurationForm, 'appId').value.trim(), input(configurationForm, 'clientId').value, (configurationForm.elements.namedItem('registration') as HTMLTextAreaElement).value);
    const list = document.getElementById('configuration-values')!;
    list.replaceChildren();
    for (const [name, value] of Object.entries(values)) {
      const label = document.createElement('dt'); label.textContent = name;
      const entry = document.createElement('dd');
      const pre = document.createElement('pre'); pre.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
      entry.append(pre); list.append(label, entry);
    }
    document.getElementById('configuration-result')!.hidden = false;
    document.getElementById('configuration-error')!.textContent = '';
    input(form, 'repo').value = input(configurationForm, 'repo').value;
    input(form, 'origin').value = input(configurationForm, 'website').value;
  } catch (error) {
    document.getElementById('configuration-error')!.textContent = error instanceof Error ? error.message : 'Check the settings.';
  }
});
document.getElementById('generate-secret')!.addEventListener('click', () => {
  document.getElementById('session-secret')!.textContent = sessionSecret();
  document.getElementById('copy-secret')!.textContent = 'Copy secret';
  document.getElementById('secret-result')!.hidden = false;
});
document.getElementById('copy-secret')!.addEventListener('click', async event => {
  const button = event.currentTarget as HTMLButtonElement;
  try { await navigator.clipboard.writeText(document.getElementById('session-secret')!.textContent!); button.textContent = 'Copied'; }
  catch { button.textContent = 'Select the secret to copy'; }
});
void fetch('/api/v6/setup', { cache: 'no-store' }).then(async response => {
  const state = await response.json() as { configured: boolean };
  document.getElementById('deployment-status')!.textContent = state.configured ? 'Your service is configured. Check a repository below to generate its embed code.' : 'Your service is deployed. Connect GitHub and choose the websites where comments will appear.';
}).catch(() => { document.getElementById('deployment-status')!.textContent = 'Connect GitHub and configure your service below.'; });
