import { useRef, useState } from 'react';
import { api } from '../api';
import { blobToBase64, normalizePortraitUpload } from '../media/portrait';

const PORTRAIT_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M12 16V4m0 0L7 9m5-5 5 5M5 20h14"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function RemoveIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="m7 7 10 10M17 7 7 17"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2.25"
      />
    </svg>
  );
}

export default function PortraitControls({
  characterId,
  characterName,
  portraitBase64,
  onChanged,
  onError,
  // The control is subject-agnostic: a companion supplies its own writers and
  // a larger frame, while a character keeps the character-portrait defaults.
  onUpload,
  onRemove,
  size,
}) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [failedPortrait, setFailedPortrait] = useState(null);
  const hasPortrait = Boolean(portraitBase64);
  const canDisplayPortrait = hasPortrait && failedPortrait !== portraitBase64;
  const displayName = characterName || characterId;

  const choosePortrait = () => inputRef.current?.click();

  const uploadPortrait = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setBusy(true);
    try {
      const { blob } = await normalizePortraitUpload(file);
      const base64 = await blobToBase64(blob);
      const next = onUpload
        ? await onUpload(base64)
        : await api.characters.setPortrait(characterId, base64);
      setFailedPortrait(null);
      onChanged?.(next);
    } catch (error) {
      onError?.(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const removePortrait = async () => {
    setBusy(true);
    try {
      const next = onRemove
        ? await onRemove()
        : await api.characters.removePortrait(characterId);
      setFailedPortrait(null);
      onChanged?.(next);
    } catch (error) {
      onError?.(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`fcb-portrait-controls${size === 'lg' ? ' fcb-portrait-controls--lg' : ''}`}
      data-has-portrait={hasPortrait ? 'true' : 'false'}
    >
      <div className="fcb-portrait-frame">
        <button
          type="button"
          className="fcb-portrait fcb-portrait-button"
          onClick={choosePortrait}
          disabled={busy}
          aria-label={`${hasPortrait ? 'Change' : 'Add'} portrait for ${displayName}`}
          title={`${hasPortrait ? 'Change' : 'Upload'} portrait`}
        >
          {canDisplayPortrait ? (
            <img
              src={`data:image/png;base64,${portraitBase64}`}
              alt={`${displayName} portrait`}
              onError={() => setFailedPortrait(portraitBase64)}
            />
          ) : (
            <span aria-hidden="true">
              {displayName.trim().slice(0, 1).toUpperCase() || '?'}
            </span>
          )}
        </button>
        <div className="fcb-portrait-overlay">
          <button
            type="button"
            className="fcb-portrait-overlay-action"
            onClick={choosePortrait}
            disabled={busy}
            aria-label={`${hasPortrait ? 'Change' : 'Upload'} portrait for ${displayName}`}
            title={`${hasPortrait ? 'Change' : 'Upload'} portrait`}
          >
            <UploadIcon />
          </button>
          {hasPortrait && (
            <button
              type="button"
              className="fcb-portrait-remove"
              onClick={removePortrait}
              disabled={busy}
              aria-label={`Remove portrait for ${displayName}`}
              title="Remove portrait"
            >
              <RemoveIcon />
            </button>
          )}
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={PORTRAIT_ACCEPT}
        className="hidden"
        onChange={uploadPortrait}
        disabled={busy}
      />
    </div>
  );
}
