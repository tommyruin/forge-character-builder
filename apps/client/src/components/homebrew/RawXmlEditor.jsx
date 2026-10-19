// An element whose XML is its source: one made with the earlier editor, one of a type the forms do
// not cover yet, or one the author chose to edit as XML. The XML must stay one `<element>`; its
// name, type and id are read from it so the list and the health checks follow what is written.

import { useMemo } from 'react';
import { Field } from '../custom/fields';

export function readElementXml(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) return { error: 'The XML is not well-formed.' };
  const root = doc.documentElement;
  if (root.tagName !== 'element') return { error: 'The XML must be one <element>.' };
  return {
    name: root.getAttribute('name') ?? '',
    type: root.getAttribute('type') ?? '',
    id: root.getAttribute('id') ?? '',
  };
}

export default function RawXmlEditor({ value, onChange, disabled = false }) {
  const problem = useMemo(() => readElementXml(value).error ?? null, [value]);
  return (
    <Field label="Element XML">
      <textarea
        className="fcb-textarea font-mono text-xs"
        data-testid="hb-raw-xml"
        aria-label="Element XML"
        rows={18}
        spellCheck={false}
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {problem && (
        <span role="alert" className="fcb-alert mt-1 block text-xs normal-case tracking-normal">
          {problem}
        </span>
      )}
    </Field>
  );
}
