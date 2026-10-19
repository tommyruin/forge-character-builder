// A text area whose lines are a list: the draft holds the non-empty lines, and the box keeps what
// the author typed (a new line pressed at the end stays until text follows it).

import { useEffect, useState } from 'react';

const toLines = (text) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');

export default function LinesInput({ value, onChange, label, placeholder, rows = 4 }) {
  const [text, setText] = useState(value.join('\n'));
  useEffect(() => {
    // The draft changed from elsewhere (another element opened): show it.
    setText((current) => (toLines(current).join('\n') === value.join('\n') ? current : value.join('\n')));
  }, [value]);
  return (
    <textarea
      className="fcb-textarea"
      aria-label={label}
      placeholder={placeholder}
      rows={rows}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        onChange(toLines(event.target.value));
      }}
    />
  );
}
