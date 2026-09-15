import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api } from "../../api";
import { useWorkspace } from "../WorkspaceContext";
import DescriptionPanel from "../DescriptionPanel";
import Icon from "../Icon";
import SectionNav from "../SectionNav";
import WorkspaceTabLayout, { WorkspaceBand } from "../WorkspaceTabLayout";
import useMobileDescriptionNavigation from "../../hooks/useMobileDescriptionNavigation";
import {
  InformationButton,
  InspectableItemButton,
} from "../InspectableItemControls";
import Modal from "../Modal";
import { resolveMagicBaseAction } from "../magicBaseAction";

// Engine-provided equip-slot tokens -> button labels. The engine classifies by the
// item's real equipment slots, so magic armor yields ['armor'] and shows "Equip"
// rather than the Main/Off-hand buttons a display-type guess would produce.
const EQUIP_ACTION_LABELS = {
  armor: "Equip",
  primary: "Main hand",
  secondary: "Off hand",
  "primary-twohanded": "Two-handed",
  // A slotless item fills no hand or armor slot: it is simply worn.
  worn: "Wear",
};

const EQUIP_ACTION_ICONS = {
  armor: "armor",
  primary: "main-hand",
  secondary: "off-hand",
  "primary-twohanded": "two-handed",
  worn: "check",
};

function categorySlug(value) {
  return String(value ?? "category")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "category";
}

export function normalizeEquipmentCategories(value) {
  const usedKeys = new Set();
  return (Array.isArray(value) ? value : []).flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const label = String(raw.label ?? raw.name ?? raw.key ?? raw.id ?? "").trim();
    if (!label) return [];
    const baseKey = String(raw.key ?? raw.id ?? categorySlug(label)).trim() || categorySlug(label);
    let key = baseKey;
    let suffix = 2;
    while (usedKeys.has(key)) key = `${baseKey}-${suffix++}`;
    usedKeys.add(key);
    return [{
      ...raw,
      key,
      label,
      elementType: raw.elementType ?? null,
      itemCategory: raw.itemCategory ?? null,
      equipSetter: raw.equipSetter ?? null,
    }];
  });
}

// The equip locations to offer for an item. Uses the engine's classification;
// falls back to the display-type guess only if an older payload omits the field.
function equipLocationsFor(item) {
  if (item.equipLocations?.length) return item.equipLocations;
  return item.type === "Armor" ? ["armor"] : ["primary", "secondary"];
}

// EQUIPMENT tab: the catalog sub-tab browses content and adds items (toast + "×N owned"
// badge confirm each add); the Inventory sub-tab is the single management surface,
// so the catalog carries no inventory dock of its own.
export default function EquipmentTab() {
  const {
    id,
    busy,
    run,
    notify,
    getCachedResource,
    setCachedResource,
    resetPrimaryScroll,
  } = useWorkspace();
  const [subTab, setSubTab] = useState("catalog");
  const [inventory, setInventory] = useState(null);
  const [inspected, setInspected] = useState(null);
  const [extracting, setExtracting] = useState(null);
  const [flashIds, setFlashIds] = useState(() => new Set());
  const [error, setError] = useState(null);
  const physicalInventory = inventory
    ? {
        ...inventory,
        items: inventory.items.filter((item) => item.isPhysicalEquipment),
      }
    : null;

  const refreshInventory = useCallback(
    (force = false) => {
      getCachedResource(`inventory:${id}`, () => api.characters.inventory(id), {
        force,
      })
        .then((data) => {
          setError(null);
          setInventory(data);
        })
        .catch((e) => setError(e.message));
    },
    [getCachedResource, id],
  );

  useEffect(() => {
    refreshInventory();
  }, [refreshInventory]);

  const mutate = async (operation) => {
    const result = await run(operation);
    if (result?.items) {
      setCachedResource(`inventory:${id}`, result);
      setInventory(result);
    } else refreshInventory();
    return result;
  };

  // Flash rows whose entry is new or whose stack grew, so an Add is visibly confirmed.
  const flashChangedRows = (before, updated) => {
    if (!updated?.items) return;
    const previous = new Map(
      (before?.items ?? []).map((entry) => [entry.identifier, entry.amount]),
    );
    const changed = updated.items
      .filter(
        (entry) =>
          !previous.has(entry.identifier) ||
          previous.get(entry.identifier) < entry.amount,
      )
      .map((entry) => entry.identifier);
    if (!changed.length) return;
    setFlashIds(new Set(changed));
    window.setTimeout(() => setFlashIds(new Set()), 2000);
  };

  const addItem = async (
    item,
    amount = 1,
    baseElementId = null,
    baseName = null,
  ) => {
    const before = inventory;
    try {
      const result = await mutate(() =>
        api.characters.addItem(id, item.id, amount, baseElementId),
      );
      flashChangedRows(before, result);
      notify(
        <>
          Added{" "}
          <strong>{baseName ? `${item.name} (${baseName})` : item.name}</strong>{" "}
          to your inventory
        </>,
      );
    } catch {
      // run() already surfaced the failure in the workspace error banner.
    }
  };

  const extractItem = async (item) => {
    const before = inventory;
    try {
      const result = await mutate(() =>
        api.characters.extractItem(id, item.identifier),
      );
      flashChangedRows(before, result);
      setExtracting(null);
      notify(
        <>
          Extracted <strong>{item.name}</strong> into your inventory
        </>,
      );
    } catch {
      // run() keeps the pack intact and surfaces the engine error.
    }
  };

  // The band belongs to the tab, but the shell belongs to whichever view is
  // showing: each view brings its own rail, and a rail has to be a child of the
  // shell to be part of the band stack. Passing the band down keeps one shell
  // per render rather than nesting a second layout inside the first.
  const band = (
    <WorkspaceBand>
      <nav
        className="fcb-secondary-tabs fcb-segmented-tabs"
        aria-label="Equipment sections"
      >
        {[
          ["catalog", "Equipment"],
          [
            "inventory",
            physicalInventory
              ? `Inventory (${physicalInventory.items.length})`
              : "Inventory",
          ],
        ].map(([key, label]) => (
          <button
            key={key}
            aria-current={subTab === key ? "page" : undefined}
            className={`fcb-tab ${subTab === key ? "is-active" : ""}`}
            onClick={() => {
              setSubTab(key);
              resetPrimaryScroll();
            }}
          >
            {label}
          </button>
        ))}
      </nav>
    </WorkspaceBand>
  );

  const notices = error ? <p className="fcb-alert mb-4">{error}</p> : null;
  const modals = (
    <ExtractEquipmentModal
      item={extracting}
      busy={busy}
      onClose={() => setExtracting(null)}
      onConfirm={extractItem}
    />
  );

  if (subTab === "inventory") {
    return physicalInventory ? (
      <Inventory
        band={band}
        notices={notices}
        modals={modals}
        inventory={physicalInventory}
        busy={busy}
        flashIds={flashIds}
        onInspect={setInspected}
        inspected={inspected}
        onEquip={(identifier, location) =>
          mutate(() => api.characters.equipItem(id, identifier, location))
        }
        onSetStorage={(identifier, storage) =>
          mutate(() => api.characters.setItemStorage(id, identifier, storage))
        }
        onAttune={(identifier, attuned) =>
          mutate(() => api.characters.attuneItem(id, identifier, attuned))
        }
        onExtract={setExtracting}
        onRemove={(identifier) =>
          mutate(() => api.characters.removeItem(id, identifier))
        }
        onAddAttack={async (identifier) => {
          // Equipping a weapon adds its row automatically; this is the way in
          // for one that is carried rather than wielded.
          await run(() =>
            api.characters.createAttack(id, { mode: "weapon", identifier }),
          );
          refreshInventory(true);
          notify("Attack row added. Edit it on the Manage tab.");
        }}
        onSetCoins={(coins) => mutate(() => api.characters.setCoins(id, coins))}
      />
    ) : (
      <WorkspaceTabLayout className="fcb-equipment-tab" bands={band}>
        {notices}
        {modals}
      </WorkspaceTabLayout>
    );
  }

  return (
    <Catalog
      band={band}
      notices={notices}
      modals={modals}
      busy={busy}
      inventory={physicalInventory}
      onInspect={setInspected}
      onAdd={addItem}
      inspected={inspected}
    />
  );
}

export function EquipmentCategoryError({ message, onRetry }) {
  return (
    <div className="fcb-alert" role="alert">
      <p>Equipment categories could not be loaded: {message}</p>
      <button type="button" className="fcb-button mt-3" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

function Catalog({
  band,
  notices,
  modals,
  busy,
  inventory,
  onAdd,
  onInspect,
  inspected,
}) {
  const {
    id,
    detail,
    registerPrimaryScroll,
    registerDetailsScroll,
    resetPrimaryScroll,
    libraryRevision,
    active,
    createLibraryPickerRefreshController,
    ensureLibraryRevisionReady,
  } = useWorkspace();
  const [categories, setCategories] = useState(null);
  const [categoryError, setCategoryError] = useState(null);
  const [categoryRequest, setCategoryRequest] = useState(0);
  const [categoryKey, setCategoryKey] = useState(null);
  const [categoryRefreshing, setCategoryRefreshing] = useState(false);
  const [categoryRefreshError, setCategoryRefreshError] = useState(null);
  const [categoryRefreshAttempt, setCategoryRefreshAttempt] = useState(0);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [searchResult, setSearchResult] = useState({
    key: null,
    page: null,
    error: null,
  });
  const [searchRequest, setSearchRequest] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchRefreshing, setSearchRefreshing] = useState(false);
  const [searchRefreshError, setSearchRefreshError] = useState(null);
  const [searchRefreshAttempt, setSearchRefreshAttempt] = useState(0);
  const searchContainer = useRef(null);
  const [page, setPage] = useState(null);
  const [skip, setSkip] = useState(0);
  // The magic item awaiting a base-weapon/armor choice, with its legal base options
  // preloaded (distinct from `inspected`, which only drives the description panel).
  const [baseItem, setBaseItem] = useState(null);
  // The magic item whose base options are being fetched after an Add press.
  const [basePending, setBasePending] = useState(null);
  const [baseError, setBaseError] = useState(null);
  const [categoryRefreshController] = useState(() =>
    createLibraryPickerRefreshController(libraryRevision),
  );
  const [searchRefreshController] = useState(() =>
    createLibraryPickerRefreshController(libraryRevision),
  );
  const searchRequestGeneration = useRef(0);
  const categoryPageRequestGeneration = useRef(0);
  const { inspect: inspectItem, descriptionPanelProps } =
    useMobileDescriptionNavigation({
      onInspect,
      registerDetailsScroll,
    });

  const activeCategory =
    categories?.find((category) => category.key === categoryKey) ??
    categories?.[0] ??
    null;
  const needsBase = Boolean(activeCategory?.equipSetter);
  const baseSlot = baseItem?.slot ?? activeCategory?.equipSetter ?? null;
  const showBaseSelector = Boolean(baseItem || needsBase);
  const ruleset = detail?.rulesetMode ?? "all";
  const searchResultKey = debouncedSearch
    ? `${debouncedSearch}\u0000${ruleset}\u0000${searchRequest}`
    : null;
  const activeSearchResult =
    searchResult.key === searchResultKey ? searchResult : null;

  const loadCategories = useCallback(
    () => api.content.equipmentCategories().then(normalizeEquipmentCategories),
    [],
  );

  useEffect(() => {
    if (!active || categories !== null) return undefined;
    let alive = true;
    loadCategories()
      .then((result) => {
        if (!alive) return;
        setCategoryError(null);
        setCategories(result);
        setCategoryKey((current) =>
          result.some((category) => category.key === current)
            ? current
            : (result[0]?.key ?? null),
        );
      })
      .catch((caught) => {
        if (!alive) return;
        setCategoryError(
          caught?.message ?? "The equipment categories request failed.",
        );
      });
    return () => {
      alive = false;
    };
  }, [active, categories, categoryRequest, loadCategories]);

  useEffect(() => {
    if (!active || libraryRevision === 0) {
      return undefined;
    }
    const request = categoryRefreshController.request(
      libraryRevision,
      active,
      () =>
        ensureLibraryRevisionReady(libraryRevision, active).then(() => {
          api.content.clearCache?.();
          return loadCategories();
        }),
    );
    if (!request) return undefined;
    let alive = true;
    Promise.resolve().then(() => {
      if (!alive) return;
      setCategoryRefreshing(true);
      setCategoryRefreshError(null);
    });
    request
      .then((result) => {
        if (!alive || result.stale) return;
        categoryPageRequestGeneration.current += 1;
        setCategories(result.value);
        setCategoryKey((current) =>
          result.value.some((category) => category.key === current)
            ? current
            : (result.value[0]?.key ?? null),
        );
        setCategoryRefreshing(false);
      })
      .catch((caught) => {
        if (!alive) return;
        setCategoryRefreshing(false);
        setCategoryRefreshError(caught.message);
      });
    return () => {
      alive = false;
    };
  }, [
    active,
    categoryRefreshAttempt,
    ensureLibraryRevisionReady,
    libraryRevision,
    loadCategories,
    categoryRefreshController,
  ]);

  // Adding a magic weapon/armor: only ask for a base when there is a real choice.
  // Zero legal bases -> add directly; exactly one -> add on that base immediately;
  // more than one -> open the base picker with the options already loaded.
  const addMagicItem = async (item) => {
    setBasePending(item.id);
    setBaseError(null);
    try {
      const res = await api.characters.itemOptions(id, item.id);
      const action = resolveMagicBaseAction(res);
      if (action.requiresSelection) {
        setBaseItem({
          id: item.id,
          name: item.name,
          options: action.options,
          slot: action.slot,
        });
        setSearchOpen(false);
        inspectItem(item.id);
      } else {
        setBaseItem(null);
        await onAdd(item, 1, action.baseElementId, action.baseName);
      }
    } catch (e) {
      setBaseError(e.message);
    } finally {
      setBasePending(null);
    }
  };

  // How many of each catalog element the character already owns (stacks included).
  const ownedCounts = useMemo(() => {
    const counts = new Map();
    for (const entry of inventory?.items ?? []) {
      const key = entry.displayElementId ?? entry.itemId;
      counts.set(key, (counts.get(key) ?? 0) + entry.amount);
    }
    return counts;
  }, [inventory]);

  useEffect(() => {
    const handle = window.setTimeout(
      () => setDebouncedSearch(deferredSearch.trim()),
      250,
    );
    return () => window.clearTimeout(handle);
  }, [deferredSearch]);

  useEffect(() => {
    if (!active || !debouncedSearch) return undefined;

    const controller = new AbortController();
    const requestKey = searchResultKey;
    const generation = ++searchRequestGeneration.current;
    api.content
      .elements(
        {
          equipmentOnly: true,
          ruleset,
          search: debouncedSearch,
          skip: 0,
          take: 20,
        },
        { signal: controller.signal },
      )
      .then((result) => {
        if (generation !== searchRequestGeneration.current) return;
        setSearchResult({
          key: requestKey,
          page: result,
          error: null,
        });
        setSearchRefreshing(false);
      })
      .catch((caught) => {
        if (
          caught.name !== "AbortError" &&
          generation === searchRequestGeneration.current
        ) {
          setSearchResult((current) => ({
            key: requestKey,
            page: current.key === requestKey ? current.page : null,
            error: caught.message,
          }));
          setSearchRefreshing(false);
        }
      });
    return () => {
      controller.abort();
      if (generation === searchRequestGeneration.current) {
        searchRequestGeneration.current += 1;
      }
    };
  }, [active, debouncedSearch, ruleset, searchRequest, searchResultKey]);

  useEffect(() => {
    if (!active || !debouncedSearch || libraryRevision === 0) {
      return undefined;
    }
    const request = searchRefreshController.request(
      libraryRevision,
      active,
      () => {
        const generation = ++searchRequestGeneration.current;
        return ensureLibraryRevisionReady(libraryRevision, active)
          .then(() => {
            api.content.clearCache?.();
            return api.content.elements({
              equipmentOnly: true,
              ruleset,
              search: debouncedSearch,
              skip: 0,
              take: 20,
            });
          })
          .then((page) => ({ generation, page }));
      },
      searchResultKey,
    );
    if (!request) return undefined;
    let alive = true;
    Promise.resolve().then(() => {
      if (!alive) return;
      setSearchRefreshing(true);
      setSearchRefreshError(null);
    });
    request
      .then((result) => {
        if (
          !alive ||
          result.stale ||
          result.value.generation !== searchRequestGeneration.current
        ) {
          return;
        }
        setSearchResult({
          key: searchResultKey,
          page: result.value.page,
          error: null,
        });
        setSearchRefreshing(false);
      })
      .catch((caught) => {
        if (!alive) return;
        setSearchRefreshing(false);
        setSearchRefreshError(caught.message);
      });
    return () => {
      alive = false;
    };
  }, [
    active,
    debouncedSearch,
    ensureLibraryRevisionReady,
    searchRefreshAttempt,
    libraryRevision,
    ruleset,
    searchResultKey,
    searchRefreshController,
  ]);

  useEffect(() => {
    if (!searchOpen) return undefined;
    const closeOnOutsidePress = (event) => {
      if (!searchContainer.current?.contains(event.target)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsidePress);
  }, [searchOpen]);

  useEffect(() => {
    if (!active || !activeCategory) return undefined;
    const controller = new AbortController();
    const generation = ++categoryPageRequestGeneration.current;
    const params = {
      take: 100,
      skip,
      ruleset: detail?.rulesetMode ?? "all",
    };
    if (activeCategory.elementType) params.type = activeCategory.elementType;
    if (activeCategory.equipSetter)
      params.equipSetter = activeCategory.equipSetter;
    if (activeCategory.itemCategory)
      params.itemCategory = activeCategory.itemCategory;
    api.content
      .elements(params, { signal: controller.signal })
      .then((result) => {
        if (generation !== categoryPageRequestGeneration.current) return;
        if (skip > 0 && skip >= result.total) {
          const lastPage = Math.max(
            0,
            Math.floor(Math.max(0, result.total - 1) / params.take) *
              params.take,
          );
          setSkip(lastPage);
          return;
        }
        setPage(result);
      })
      .catch((e) => {
        if (
          e.name !== "AbortError" &&
          generation === categoryPageRequestGeneration.current
        ) {
          setPage(null);
        }
      });
    return () => {
      controller.abort();
      if (generation === categoryPageRequestGeneration.current) {
        categoryPageRequestGeneration.current += 1;
      }
    };
  }, [active, activeCategory, detail?.rulesetMode, skip]);

  // Every return goes through the shell so the sub-tab bar stays put while the
  // catalog is loading, failing or empty.
  const shell = (children, props = {}) => (
    <WorkspaceTabLayout
      className="fcb-equipment-tab"
      bands={band}
      {...props}
      // Above the rail, not inside the content region: the content region is a
      // grid, and a status line dropped into it becomes a cell.
      lead={
        <>
          {notices}
          {props.lead}
        </>
      }
    >
      {children}
      {modals}
    </WorkspaceTabLayout>
  );

  if (categoryError) {
    return shell(
      <EquipmentCategoryError
        message={categoryError}
        onRetry={() => {
          setCategories(null);
          setCategoryError(null);
          setCategoryRequest((request) => request + 1);
        }}
      />,
    );
  }

  if (categories === null)
    return shell(<p className="fcb-empty-copy">Loading equipment categories…</p>);

  if (!activeCategory)
    return shell(
      <p className="fcb-empty-copy">No equipment categories are loaded.</p>,
    );

  const selectCategory = (key) => {
    setCategoryKey(key);
    setSkip(0);
    setBaseItem(null);
    resetPrimaryScroll();
  };

  const catalogOptions = {
    lead: (
        <>
          {categoryRefreshing && (
            <p className="fcb-muted-copy" role="status" aria-live="polite">
              Refreshing equipment…
            </p>
          )}
          {categoryRefreshError && (
            <p className="fcb-alert" role="alert">
              Could not refresh equipment: {categoryRefreshError}{" "}
              <button
                type="button"
                className="fcb-button"
                onClick={() =>
                  setCategoryRefreshAttempt((attempt) => attempt + 1)
                }
              >
                Retry
              </button>
            </p>
          )}
        </>
      ),
      // The rail in both its forms: the select replaces the pill strip on a
      // narrow viewport, and the rule that hides the strip keys on the two
      // being adjacent siblings.
      rail: (
        <>
          <label className="fcb-mobile-category-select">
            <span>Equipment category</span>
            <select
              className="fcb-select"
              value={categoryKey}
              onChange={(event) => selectCategory(event.target.value)}
            >
              {categories.map((category) => (
                <option key={category.key} value={category.key}>
                  {category.label}
                </option>
              ))}
            </select>
          </label>
          <SectionNav
            ariaLabel="Equipment categories"
            className="fcb-equipment-category-nav"
            items={categories.map((cat) => ({
              key: cat.key,
              label: cat.label,
              detail: cat.equipSetter
                ? `Magic · ${cat.equipSetter}`
                : (cat.elementType ?? "Physical equipment"),
            }))}
            activeKey={categoryKey}
            onSelect={selectCategory}
          />
        </>
      ),
    shape: "split",
  };

  return shell(
    <>
        <div className="fcb-editor-primary fcb-equipment-primary min-w-0">
          <section className="fcb-panel fcb-equipment-catalog">
            <div className="fcb-panel-body">
              <div className="fcb-equipment-search">
                <div
                  className="fcb-global-equipment-search"
                  ref={searchContainer}
                >
                  <input
                    type="search"
                    className="fcb-input"
                    aria-label="Search all equipment"
                    aria-controls="fcb-global-equipment-results"
                    aria-expanded={searchOpen && Boolean(search.trim())}
                    placeholder="Search all equipment…"
                    value={search}
                    onFocus={() => {
                      if (search.trim()) setSearchOpen(true);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        setSearchOpen(false);
                        event.currentTarget.focus();
                      }
                    }}
                    onChange={(event) => {
                      setSearch(event.target.value);
                      setSearchOpen(Boolean(event.target.value.trim()));
                    }}
                  />
                  {searchOpen && search.trim() && (
                    <GlobalEquipmentSearchResults
                      page={activeSearchResult?.page ?? null}
                      loading={
                        search.trim() !== debouncedSearch ||
                        activeSearchResult === null ||
                        activeSearchResult.key !== searchResultKey
                      }
                      refreshing={searchRefreshing}
                      refreshError={searchRefreshError}
                      error={activeSearchResult?.error ?? null}
                      busy={busy}
                      basePending={basePending}
                      ownedCounts={ownedCounts}
                      onInspect={inspectItem}
                      onAdd={addMagicItem}
                      onRetry={() => {
                        setSearchRefreshError(null);
                        setSearchRequest((request) => request + 1);
                      }}
                      onRefreshRetry={() =>
                        setSearchRefreshAttempt((attempt) => attempt + 1)
                      }
                    />
                  )}
                </div>
              </div>
              {baseError && <p className="fcb-alert mb-3">{baseError}</p>}
              <div
                className="fcb-scroll-panel fcb-mobile-list-panel fcb-equipment-results rounded border border-[var(--fcb-border-soft)]"
                ref={registerPrimaryScroll}
              >
                <table className="fcb-table fcb-mobile-list-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Source</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {page?.items.map((item) => (
                      <tr
                        key={item.id}
                        className={
                          inspected === item.id
                            ? "fcb-row-inspected"
                            : ""
                        }
                      >
                        <td data-label="Item">
                          <InspectableItemButton
                            elementId={item.id}
                            onInspect={inspectItem}
                            className="block w-full text-left"
                          >
                            <span className="font-semibold">{item.name}</span>
                            {ownedCounts.has(item.id) && (
                              <span className="fcb-owned-badge">
                                ×{ownedCounts.get(item.id)} owned
                              </span>
                            )}
                          </InspectableItemButton>
                        </td>
                        <td
                          className="text-xs text-[var(--fcb-text-muted)]"
                          data-label="Source"
                        >
                          {item.source}
                        </td>
                        <td
                          className="text-right fcb-mobile-list-actions"
                          data-label="Actions"
                        >
                          <span className="inline-flex items-center justify-end gap-1">
                            <InformationButton
                              elementId={item.id}
                              label={item.name}
                              onInspect={inspectItem}
                            />
                            <button
                              disabled={busy || Boolean(basePending)}
                              aria-label={`Add ${item.name}`}
                              onClick={() =>
                                needsBase ? addMagicItem(item) : onAdd(item, 1)
                              }
                              className="fcb-button"
                            >
                              <Icon name="add" />
                              {basePending === item.id ? "Adding…" : "Add"}
                            </button>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {page && page.total > 100 && (
                <div className="fcb-toolbar mt-3 text-sm text-[var(--fcb-text-muted)]">
                  <button
                    disabled={skip === 0}
                    onClick={() => setSkip(Math.max(0, skip - 100))}
                    className="fcb-button"
                  >
                    Prev
                  </button>
                  {skip + 1}-{Math.min(skip + 100, page.total)} of {page.total}
                  <button
                    disabled={skip + 100 >= page.total}
                    onClick={() => setSkip(skip + 100)}
                    className="fcb-button"
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          </section>
        </div>

        {showBaseSelector ? (
          <div className="space-y-4">
            <BaseSelector
              key={baseItem?.id ?? "none"}
              item={baseItem}
              slot={baseSlot}
              busy={busy}
              onAdd={async (...args) => {
                await onAdd(...args);
                setBaseItem(null);
              }}
            />
            <DescriptionPanel
              {...descriptionPanelProps}
              elementId={inspected}
              placeholder={`Select a magic ${baseSlot ?? "item"}`}
              returnLabel="Back to equipment"
              detailsLabel="Equipment details"
            />
          </div>
        ) : (
          <DescriptionPanel
            {...descriptionPanelProps}
            elementId={inspected}
            placeholder="Equipment"
            returnLabel="Back to equipment"
            detailsLabel="Equipment details"
          />
        )}
    </>,
    catalogOptions,
  );
}

export function GlobalEquipmentSearchResults({
  page,
  loading,
  refreshing = false,
  refreshError = null,
  error,
  busy,
  basePending,
  ownedCounts,
  onInspect,
  onAdd,
  onRetry,
  onRefreshRetry,
}) {
  return (
    <div
      id="fcb-global-equipment-results"
      className="fcb-global-equipment-results"
      role="region"
      aria-label="Global equipment search results"
    >
      {refreshing && (
        <p className="fcb-global-equipment-status" role="status">
          Refreshing equipment…
        </p>
      )}
      {refreshError && (
        <div className="fcb-global-equipment-status" role="alert">
          <p>Could not refresh equipment: {refreshError}</p>
          <button
            type="button"
            className="fcb-button mt-2"
            onClick={onRefreshRetry}
          >
            Retry
          </button>
        </div>
      )}
      {loading && (
        <p className="fcb-global-equipment-status" role="status">
          Searching all equipment…
        </p>
      )}
      {!page && error ? (
        <div className="fcb-global-equipment-status" role="alert">
          <p>{error}</p>
          <button
            type="button"
            className="fcb-button mt-2"
            onClick={onRetry}
          >
            Retry
          </button>
        </div>
      ) : !page ? null : page?.items?.length ? (
        <>
          <ul className="fcb-global-equipment-list" role="list">
            {page.items.map((item) => (
              <li key={item.id} className="fcb-global-equipment-result">
                <div className="fcb-global-equipment-copy">
                  <InspectableItemButton
                    elementId={item.id}
                    onInspect={onInspect}
                    className="fcb-global-equipment-name"
                  >
                    <span className="font-semibold">{item.name}</span>
                    {ownedCounts.has(item.id) && (
                      <span className="fcb-owned-badge">
                        ×{ownedCounts.get(item.id)} owned
                      </span>
                    )}
                  </InspectableItemButton>
                  <span className="fcb-global-equipment-source">
                    {item.source}
                  </span>
                </div>
                <span className="fcb-global-equipment-actions">
                  <InformationButton
                    elementId={item.id}
                    label={item.name}
                    onInspect={onInspect}
                  />
                  <button
                    type="button"
                    className="fcb-button"
                    aria-label={`Add ${item.name}`}
                    disabled={busy || Boolean(basePending)}
                    onClick={() => onAdd(item)}
                  >
                    <Icon name="add" />
                    {basePending === item.id ? "Adding…" : "Add"}
                  </button>
                </span>
              </li>
            ))}
          </ul>
          {page.total > page.items.length && (
            <p className="fcb-global-equipment-limit">
              {page.total} matches. Refine your search to see fewer results.
            </p>
          )}
        </>
      ) : (
        <p className="fcb-global-equipment-status" role="status">
          No equipment matches that name.
        </p>
      )}
    </div>
  );
}

// The Magic Weapons / Magic Armor base-item picker: it adds the magic item as an
// adorner on the chosen base (so "+1 weapon" becomes
// "+1 Longsword"). Only shown when there is a real choice — the catalog adds single-base
// and baseless items directly. Keyed by item id, so state resets per item.
function BaseSelector({ item, slot, busy, onAdd }) {
  const options = item?.options ?? [];
  const [baseId, setBaseId] = useState(() => options[0]?.id ?? "");
  const label = slot === "weapon" ? "weapon" : "armor";

  return (
    <section className="fcb-panel">
      <header className="fcb-panel-header">
        <div>
          <h2 className="fcb-panel-title">Base {label}</h2>
          <p className="fcb-panel-subtitle">
            {item
              ? `Choose the base ${label} ${item.name} enhances.`
              : `Magic ${label}s with a single legal base are added straight to your inventory.`}
          </p>
        </div>
      </header>
      <div className="fcb-panel-body">
        {!item && (
          <p className="fcb-empty-copy">Nothing to choose right now.</p>
        )}
        {item && (
          <>
            <label className="fcb-field-label block">
              Base {label} ({options.length})
              <select
                className="fcb-input mt-1 block w-full"
                value={baseId}
                onChange={(e) => setBaseId(e.target.value)}
              >
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="fcb-button fcb-button-primary mt-3"
              disabled={busy || !baseId}
              onClick={() =>
                onAdd(
                  item,
                  1,
                  baseId,
                  options.find((o) => o.id === baseId)?.name ?? null,
                )
              }
            >
              <Icon name="add" />
              Add to inventory
            </button>
          </>
        )}
      </div>
    </section>
  );
}

function Inventory({
  band,
  notices,
  modals,
  inventory,
  busy,
  flashIds,
  onEquip,
  onSetStorage,
  onAttune,
  onExtract,
  onRemove,
  onAddAttack,
  onSetCoins,
  onInspect,
  inspected,
}) {
  const { registerPrimaryScroll, registerDetailsScroll } = useWorkspace();
  const [coinDraft, setCoinDraft] = useState({});
  const coins = { ...inventory.coins, ...coinDraft };
  const { inspect: inspectItem, descriptionPanelProps } =
    useMobileDescriptionNavigation({
      onInspect,
      registerDetailsScroll,
    });

  return (
    <WorkspaceTabLayout
      className="fcb-equipment-tab"
      bands={band}
      lead={notices}
      shape="two-panel"
    >
      {/* The panel clips to its radius and the region inside it scrolls: a
          scrollbar is painted on the border box, so a rounded panel that
          scrolls itself loses the radius down its scrollbar edge. */}
      <section className="fcb-panel fcb-inventory-primary">
        <header className="fcb-panel-header">
          <div>
            <h2 className="fcb-panel-title">Inventory</h2>
            <div className="fcb-toolbar mt-2">
              <span className="fcb-stat-pill">
                Attuned{" "}
                <strong>
                  {inventory.attunedItemCount}/{inventory.maxAttunedItemCount}
                </strong>
              </span>
              <span className="fcb-stat-pill">
                Carried <strong>{inventory.equipmentWeight} lb</strong>
              </span>
            </div>
          </div>
        </header>
        <div className="fcb-panel-body fcb-inventory-body">
          {/* The scroll region is inset by the body's padding, so its
              scrollbar never reaches the panel's rounded corners. */}
          <div className="fcb-inventory-scroll" ref={registerPrimaryScroll}>
          <div className="rounded border border-[var(--fcb-border-soft)]">
            <table className="fcb-table fcb-inventory-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Qty</th>
                  <th>Equipped</th>
                  <th>Storage</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {inventory.items.map((item) => (
                  <tr
                    key={item.identifier}
                    className={`${flashIds.has(item.identifier) ? "is-flash" : ""} ${inspected === (item.displayElementId ?? item.itemId) ? "fcb-row-inspected" : ""}`}
                  >
                    <td data-label="Item">
                      <div className="fcb-inventory-item-header">
                        <InspectableItemButton
                          elementId={item.displayElementId ?? item.itemId}
                          onInspect={inspectItem}
                          className="fcb-inventory-item-name text-left"
                        >
                          <span className="font-semibold">{item.name}</span>
                          <span className="fcb-inventory-item-type ml-2 text-xs text-[var(--fcb-text-faint)]">
                            {item.type}
                          </span>
                        </InspectableItemButton>
                        <span className="fcb-inventory-desktop-info">
                          <InformationButton
                            elementId={item.displayElementId ?? item.itemId}
                            label={item.name}
                            onInspect={inspectItem}
                            className="fcb-inventory-info"
                          />
                        </span>
                        <span className="fcb-inventory-mobile-actions">
                          <InformationButton
                            elementId={item.displayElementId ?? item.itemId}
                            label={item.name}
                            onInspect={inspectItem}
                            className="fcb-inventory-info"
                          />
                          <InventoryActionButtons
                            item={item}
                            busy={busy}
                            onEquip={onEquip}
                            onAttune={onAttune}
                            onExtract={onExtract}
                            onRemove={onRemove}
                            onAddAttack={onAddAttack}
                            variant="mobile"
                          />
                        </span>
                      </div>
                      {item.notes ? (
                        <div className="text-xs italic text-[var(--fcb-text-faint)]">
                          {item.notes}
                        </div>
                      ) : null}
                    </td>
                    <td data-label="Qty">{item.amount}</td>
                    <td className="text-xs" data-label="Equipped">
                      {item.isEquipped ? (
                        <span className="fcb-success-note">
                          {item.equippedLocation}
                        </span>
                      ) : (
                        <span className="text-[var(--fcb-text-faint)]">
                          —
                        </span>
                      )}
                    </td>
                    <td className="text-xs" data-label="Storage">
                      <select
                        className="fcb-input fcb-inventory-storage-select"
                        value={item.storage ?? ""}
                        disabled={busy}
                        onChange={(e) =>
                          onSetStorage(item.identifier, e.target.value || null)
                        }
                      >
                        <option value="">Carried</option>
                        {(inventory.storages ?? [])
                          .filter((name) => name !== "")
                          .map((name, index) => (
                            <option key={`${name}-${index}`} value={name}>
                              {name}
                            </option>
                          ))}
                      </select>
                    </td>
                    <td
                      className="fcb-inventory-desktop-actions text-right text-xs"
                      data-label="Actions"
                    >
                      <InventoryActionButtons
                        item={item}
                        busy={busy}
                        onEquip={onEquip}
                        onAttune={onAttune}
                        onExtract={onExtract}
                        onRemove={onRemove}
                        onAddAttack={onAddAttack}
                        variant="desktop"
                      />
                    </td>
                  </tr>
                ))}
                {inventory.items.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-[var(--fcb-text-faint)]">
                      Inventory is empty - add gear from the Equipment catalog.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-4 fcb-card fcb-inventory-coins p-3">
            <h4 className="fcb-card-title mb-3 text-sm">Manage coins</h4>
            <div className="fcb-inventory-coin-grid">
              {[
                ["copper", "CP"],
                ["silver", "SP"],
                ["electrum", "EP"],
                ["gold", "GP"],
                ["platinum", "PP"],
              ].map(([key, label]) => (
                <label
                  key={key}
                  className="fcb-field-label fcb-inventory-coin-field"
                >
                  <span>{label}</span>
                  <input
                    type="number"
                    min={0}
                    className="fcb-input fcb-inventory-coin-input"
                    value={coins[key]}
                    onChange={(e) =>
                      setCoinDraft((draft) => ({
                        ...draft,
                        [key]: parseInt(e.target.value, 10) || 0,
                      }))
                    }
                  />
                </label>
              ))}
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  Promise.resolve(onSetCoins(coins)).then(() =>
                    setCoinDraft({}),
                  )
                }
                className="fcb-button fcb-button-primary fcb-inventory-coin-apply"
              >
                Apply
              </button>
            </div>
          </div>
          </div>
        </div>
      </section>

      <DescriptionPanel
        {...descriptionPanelProps}
        elementId={inspected}
        placeholder="Inventory"
        returnLabel="Back to inventory"
        detailsLabel="Inventory item details"
      />
      {modals}
    </WorkspaceTabLayout>
  );
}

export function InventoryActionButtons({
  item,
  busy,
  onEquip,
  onAttune,
  onExtract,
  onRemove,
  onAddAttack,
  variant,
}) {
  return (
    <span
      className={`fcb-inventory-actions fcb-inventory-actions--${variant}`}
    >
      {item.isEquippable &&
        !item.isEquipped &&
        equipLocationsFor(item).map((location) => (
          <ActionButton
            key={location}
            label={EQUIP_ACTION_LABELS[location] ?? "Equip"}
            icon={EQUIP_ACTION_ICONS[location] ?? "armor"}
            disabled={busy}
            onClick={() => onEquip(item.identifier, location)}
          />
        ))}
      {item.isEquipped && (
        <ActionButton
          // A worn item occupies no slot, so there is nothing to unequip from:
          // the action is taking it off.
          label={item.equippedLocation === null ? "Remove" : "Unequip"}
          icon="unequip"
          disabled={busy}
          onClick={() => onEquip(item.identifier, "none")}
        />
      )}
      {item.isAttunable && (
        <ActionButton
          label={item.isAttuned ? "Unattune" : "Attune"}
          icon={item.isAttuned ? "unattune" : "attune"}
          disabled={busy}
          onClick={() => onAttune(item.identifier, !item.isAttuned)}
        />
      )}
      {item.isExtractable && (
        <ActionButton
          label="Extract"
          icon="extract"
          disabled={busy}
          onClick={() => onExtract(item)}
        />
      )}
      {item.type === "Weapon" && !item.hasAttackRow && onAddAttack && (
        <ActionButton
          label="Add attack"
          icon="add"
          disabled={busy}
          onClick={() => onAddAttack(item.identifier)}
        />
      )}
      <ActionButton
        label="Delete"
        icon="delete"
        disabled={busy}
        onClick={() => onRemove(item.identifier)}
      />
    </span>
  );
}

export function ExtractEquipmentModal({ item, busy, onClose, onConfirm }) {
  const contents = item?.extractableContents ?? [];
  const close = () => {
    if (!busy) onClose();
  };

  return (
    <Modal
      open={Boolean(item)}
      title="Extract pack contents"
      onClose={close}
    >
      <p>
        Extracting <strong>{item?.name}</strong> removes one pack and adds these
        items to your inventory:
      </p>
      <ul className="divide-y divide-[var(--fcb-border-soft)] rounded border border-[var(--fcb-border-soft)]">
        {contents.map((content) => (
          <li
            key={content.itemId}
            className="flex items-center justify-between gap-4 px-3 py-2"
          >
            <span>{content.name}</span>
            <strong className="tabular-nums">×{content.amount}</strong>
          </li>
        ))}
      </ul>
      <div className="fcb-toolbar mt-4 justify-end">
        <button
          type="button"
          className="fcb-button"
          disabled={busy}
          onClick={close}
        >
          Cancel
        </button>
        <button
          type="button"
          className="fcb-button fcb-button-primary"
          disabled={busy}
          onClick={() => onConfirm(item)}
        >
          {busy ? "Extracting…" : "Extract"}
        </button>
      </div>
    </Modal>
  );
}

function ActionButton({ label, icon, ...props }) {
  return (
    <button
      type="button"
      {...props}
      aria-label={label}
      title={label}
      className="fcb-button fcb-inventory-action-button px-2 py-1 text-xs"
    >
      <Icon name={icon} className="fcb-inventory-action-icon" />
      <span className="fcb-inventory-action-label">{label}</span>
    </button>
  );
}
