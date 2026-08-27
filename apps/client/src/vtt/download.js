// Trigger a browser download of a Blob under a filename. Shared by the character-file export
// and the VTT exporters so they behave identically (the pattern already used inline in
// CharacterWorkspace/CharacterList).
export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
