import { useEffect, useRef, useState } from "react";
import { shell } from "@shell";
import { api } from "../api";
import useSheetTemplateSetting from "../hooks/useSheetTemplateSetting";
import useSheetColoursSetting from "../hooks/useSheetColoursSetting";
import useSheetFontsSetting from "../hooks/useSheetFontsSetting";
import useSheetPagesSetting from "../hooks/useSheetPagesSetting";
import { loadSheetBrandImage } from "../sheetBrandImage.js";
import { downloadBlob } from "../vtt/download.js";
import Icon from './Icon';

// Export dropdown: the portable character file, either the plain .dnd5e XML document
// or the package envelope bundling custom content (.dnd5e-pkg). Character cards
// can also include the PDF sheet here, while the editor retains its dedicated SHEET-tab
// download. `variant="primary"` styles the trigger as the workspace's primary Save button.
// VTT converters (Foundry/Roll20) exist under src/vtt but are unlisted until they are
// tested end-to-end.
export default function ExportMenu({
  id,
  includeSheet = false,
  onError,
  variant = "default",
  label = "Export",
  iconOnly = false,
}) {
  const { templateSet } = useSheetTemplateSetting();
  const { colours } = useSheetColoursSetting();
  const { fonts } = useSheetFontsSetting();
  const { pages } = useSheetPagesSetting();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(null); // which item is running
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target))
        setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const portable = typeof api.characters.export === "function";

  const runAction = async (kind, action) => {
    setBusy(kind);
    onError?.(null);
    try {
      await action();
      setOpen(false);
    } catch (e) {
      onError?.(e.message);
    } finally {
      setBusy(null);
    }
  };

  const run = (kind, fn) =>
    runAction(kind, async () => {
      const { filename, blob } = await fn();
      downloadBlob(filename, blob);
    });

  const downloadSheet = () =>
    runAction("sheet", async () => {
      const brandImage = await loadSheetBrandImage();
      const url = await api.characters.sheet(id, { templateSet, colours, fonts, include: pages, brandImage, footerText: `Generated with ${shell.appName}.` });
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${id}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    });

  const items = [
    includeSheet && {
      kind: "sheet",
      text: "Character sheet (.pdf)",
      busyText: "Generating…",
      run: downloadSheet,
    },
    portable && {
      kind: "file",
      text: "Character file (.dnd5e)",
      run: () => run("file", () => api.characters.export(id)),
    },
    typeof api.characters.exportPackage === "function" && {
      kind: "package",
      text: "Character + custom content (.dnd5e-pkg)",
      run: () => run("package", () => api.characters.exportPackage(id)),
    },
  ].filter(Boolean);

  const triggerClass =
    variant === "primary"
      ? `fcb-button fcb-button-primary fcb-save-button${iconOnly ? " fcb-export-icon-only" : ""}`
      : variant === "utility"
        ? "fcb-topbar-utility fcb-export-utility"
        : `fcb-button${iconOnly ? " fcb-export-icon-only" : ""}`;

  return (
    <div className="fcb-export-menu" ref={rootRef}>
      <button
        type="button"
        className={triggerClass}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={iconOnly ? "Export character" : undefined}
        disabled={!!busy}
        onClick={() => setOpen((v) => !v)}
        title="Export this character"
      >
        {iconOnly ? (
          <svg
            aria-hidden="true"
            className="fcb-export-icon"
            viewBox="0 0 24 24"
          >
            <path d="M12 3v12m0 0 4-4m-4 4-4-4" />
            <path d="M5 17v3h14v-3" />
          </svg>
        ) : (
          <>
            {busy === "sheet" ? "Generating…" : busy ? "Exporting…" : label}{" "}
            <Icon name="chevron-down" className="fcb-icon-sm" />
          </>
        )}
      </button>
      {open && (
        <div className="fcb-export-menu-list" role="menu">
          {items.map((item) => (
            <button
              key={item.kind}
              type="button"
              role="menuitem"
              className="fcb-export-menu-item"
              disabled={!!busy}
              onClick={item.run}
            >
              {busy === item.kind ? (item.busyText ?? "Exporting…") : item.text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
