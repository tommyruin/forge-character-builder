import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ContentLoadingProgress from "../ContentLoadingProgress";

describe("ContentLoadingProgress", () => {
  it("renders the engine stage and a determinate progress bar", () => {
    const markup = renderToStaticMarkup(
      <ContentLoadingProgress
        progress={{
          active: true,
          percentage: 42,
          message: "Loading custom elements",
        }}
      />,
    );

    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('value="42"');
    expect(markup).toContain("Loading custom elements");
    expect(markup).toContain("42%");
  });

  it("shows an indeterminate bar while the open character refreshes", () => {
    const markup = renderToStaticMarkup(
      <ContentLoadingProgress
        progress={{
          active: false,
          percentage: 100,
          message: "Content library ready",
        }}
        fallbackMessage="Refreshing the open character…"
      />,
    );

    expect(markup).toContain("Refreshing the open character…");
    expect(markup).toContain("<progress");
    expect(markup).not.toContain("value=");
    expect(markup).toContain("is-indeterminate");
  });

  it("uses the character phase label when the content phase has finished", () => {
    const markup = renderToStaticMarkup(
      <ContentLoadingProgress
        phase="character"
        progress={{
          active: false,
          percentage: 100,
          message: "Content library ready",
        }}
        fallbackMessage="Preparing content update…"
      />,
    );

    expect(markup).toContain("Refreshing the open character…");
    expect(markup).not.toContain("Preparing content update…");
  });

  it("keeps the character phase label while a stale content progress event arrives", () => {
    const markup = renderToStaticMarkup(
      <ContentLoadingProgress
        phase="character"
        progress={{
          active: true,
          percentage: 100,
          message: "Loading custom elements",
        }}
      />,
    );

    expect(markup).toContain("Refreshing the open character…");
    expect(markup).not.toContain("Loading custom elements");
    expect(markup).toContain("100%");
  });

  it("labels the waiting and finalizing phases explicitly", () => {
    const waitingMarkup = renderToStaticMarkup(
      <ContentLoadingProgress phase="waiting" fallbackMessage="Stale phase" />,
    );
    const finalizingMarkup = renderToStaticMarkup(
      <ContentLoadingProgress
        phase="finalizing"
        fallbackMessage="Stale phase"
      />,
    );

    expect(waitingMarkup).toContain("Preparing content update…");
    expect(finalizingMarkup).toContain("Finishing content update…");
  });
});
