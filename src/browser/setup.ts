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
const strictInput = form.elements.namedItem('strict') as HTMLInputElement;
const termField = document.getElementById('mapping-value')!;
const termLabel = document.getElementById('mapping-value-label')!;
const strictField = document.getElementById('strict-setting')!;
const escapeAttribute = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function updateMappingFields(): void {
  const mapping = mappingSelect.value;
  const needsTerm = mapping === 'specific' || mapping === 'number';
  termField.hidden = !needsTerm;
  termInput.disabled = !needsTerm;
  termInput.required = needsTerm;
  termInput.inputMode = mapping === 'number' ? 'numeric' : 'text';
  termLabel.textContent = mapping === 'number' ? 'Discussion number' : 'Search term';
  strictField.hidden = mapping === 'number';
  strictInput.disabled = mapping === 'number';
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
      if (mapping === 'specific' && !term) throw new Error('Enter a search term.');
      if (mapping === 'number' && !/^[1-9]\d*$/.test(term)) throw new Error('Enter a positive discussion number.');
      const response = await fetch('/api/config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo, origin }), cache: 'no-store',
      });
      const data = await response.json() as { repo: string; repoId: string; category: string; categoryId: string; error?: { message: string } };
      if (!response.ok) throw new Error(data.error?.message || 'Could not check the repository.');
      const attributes: Record<string, string> = {
        src: location.origin + '/client.js',
        'data-repo': data.repo, 'data-repo-id': data.repoId,
        'data-category': data.category, 'data-category-id': data.categoryId,
        'data-mapping': mapping,
        ...(mapping === 'specific' || mapping === 'number' ? { 'data-term': term } : {}),
        'data-strict': values.has('strict') ? '1' : '0', 'data-reactions-enabled': '1',
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
export {};
