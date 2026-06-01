/* eslint-disable -- browser-only script executed via page.evaluate new Function */
// Browser-only DOM helpers for TrainingPeaks Add Block picker scraping.
// Loaded as plain text (not via tsx/esbuild) for safe page.evaluate in the browser.
function browserPickerAction(input) {
  const SEARCH_PLACEHOLDER = "Search Exercises, Circuits, or Saved Items";
  const EXCLUDED_BUTTON_LABELS = new Set([
    "Add Block",
    "Add Exercise",
    "Owner",
    "Muscle Group",
    "Comments",
    "Private Notes",
    "Last Performance",
    "Search",
  ]);
  const EXCLUDED_UI_LABELS = new Set([
    SEARCH_PLACEHOLDER,
    "Create Custom Exercise",
    "Add Block",
    "Add Exercise",
    "Save",
    "Save & Close",
    "Summary",
    "Library",
    "Comments",
    "Private Notes",
    "Workout Title",
    "Add Workout Instructions",
    "Owner",
    "Muscle Group",
    "Last Performance",
    "Search",
    "Exercise Library",
    "search and add block or template",
    "OR SELECT TO CREATE",
    "Single Exercise",
    "Cool Down",
    "Warm Up",
  ]);
  const EXCLUDED_UI_LABELS_LOWER = new Set(
    Array.from(EXCLUDED_UI_LABELS).map((label) => label.toLowerCase()),
  );
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "SVG", "PATH", "INPUT", "TEXTAREA", "NOSCRIPT"]);

  function normalizeWhitespace(value) {
    return String(value ?? "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isHTMLElement(value) {
    return value instanceof HTMLElement;
  }

  function isVisible(element) {
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity || "1") === 0) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isExcludedLabel(text) {
    const normalized = normalizeWhitespace(text);
    if (!normalized) return true;
    const lower = normalized.toLowerCase();
    if (EXCLUDED_UI_LABELS.has(normalized)) return true;
    if (EXCLUDED_UI_LABELS_LOWER.has(lower)) return true;
    if (EXCLUDED_BUTTON_LABELS.has(normalized)) return true;
    if (/^search exercises/i.test(normalized)) return true;
    if (/^search and add block/i.test(lower)) return true;
    if (/^or select to create/i.test(lower)) return true;
    if (/^single exercise$/i.test(lower)) return true;
    if (/^warm up$/i.test(lower)) return true;
    if (/^cool down$/i.test(lower)) return true;
    return false;
  }

  function containsShellCategoryLabels(element) {
    const lower = normalizeWhitespace(element.textContent).toLowerCase();
    const hasSingle = lower.includes("single exercise");
    const hasWarm = lower.includes("warm up");
    const hasCool = lower.includes("cool down");
    const hasShellHeader = lower.includes("search and add block") || lower.includes("or select to create");
    return (hasSingle && hasWarm) || (hasSingle && hasCool) || hasShellHeader;
  }

  function rowMatchesSearchTerm(name, searchTerm) {
    const normalizedName = normalizeWhitespace(name).toLowerCase();
    const normalizedTerm = normalizeWhitespace(searchTerm).toLowerCase();
    if (!normalizedTerm) return true;
    if (normalizedName.includes(normalizedTerm)) return true;
    const tokens = normalizedTerm.split(/\s+/).filter(Boolean);
    return tokens.length > 0 && tokens.every((token) => normalizedName.includes(token));
  }

  function getSearchInputValue(searchInput) {
    if (!searchInput) return "";
    const target = extractInputLike(searchInput);
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      return normalizeWhitespace(target.value);
    }
    return normalizeWhitespace(target.textContent);
  }

  function isPlausibleExerciseName(text) {
    const normalized = normalizeWhitespace(text);
    if (!normalized || isExcludedLabel(normalized)) return false;
    if (normalized.length < 2 || normalized.length > 120) return false;
    if (/^\d+$/.test(normalized)) return false;
    if (!normalized.includes(" ") && normalized.length < 8 && !normalized.includes("-")) return false;
    return true;
  }

  function extractInputLike(element) {
    const nested =
      element.querySelector("input, textarea, [role='textbox'], [contenteditable='true']") ??
      element.querySelector("[role='combobox']");
    return isHTMLElement(nested) ? nested : element;
  }

  function scoreSearchCandidate(element) {
    const role = normalizeWhitespace(element.getAttribute("role")).toLowerCase();
    const placeholder = normalizeWhitespace(element.getAttribute("placeholder"));
    const ariaLabel = normalizeWhitespace(element.getAttribute("aria-label"));
    const text = normalizeWhitespace(element.textContent);
    const haystack = `${placeholder} ${ariaLabel} ${text}`.toLowerCase();

    let score = 0;
    if (placeholder === SEARCH_PLACEHOLDER) score += 120;
    if (ariaLabel === SEARCH_PLACEHOLDER) score += 120;
    if (haystack.includes("search exercises")) score += 90;
    if (haystack.includes("circuits")) score += 40;
    if (haystack.includes("saved items")) score += 40;
    if (haystack.includes("search")) score += 25;
    if (role === "combobox" || role === "textbox") score += 20;
    if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") score += 10;

    const nearbyHeading = element.closest("*")?.textContent ?? "";
    if (nearbyHeading.includes("Exercise Library")) score += 15;
    if (!isVisible(element)) score -= 200;

    return score;
  }

  function findSearchInput() {
    const rawCandidates = Array.from(
      document.querySelectorAll(
        "input, textarea, [role='combobox'], [role='textbox'], [contenteditable='true'], [placeholder], [aria-label]",
      ),
    );

    let best = null;
    let bestScore = -Infinity;

    for (const candidate of rawCandidates) {
      const target = extractInputLike(candidate);
      const score = scoreSearchCandidate(target);
      if (score > bestScore) {
        best = target;
        bestScore = score;
      }
    }

    return bestScore >= 25 ? best : null;
  }

  function extractRowName(element) {
    const heading = element.querySelector("h1, h2, h3, h4, h5, h6, [role='heading']");
    if (heading) {
      const text = normalizeWhitespace(heading.innerText || heading.textContent);
      if (text) return text;
    }

    const ariaLabel = normalizeWhitespace(element.getAttribute("aria-label"));
    if (ariaLabel) {
      return ariaLabel.split(/\s{2,}|\n/)[0]?.trim() ?? ariaLabel;
    }

    const text = normalizeWhitespace(element.innerText || element.textContent);
    if (!text) return "";
    const lines = text
      .split("\n")
      .map((line) => normalizeWhitespace(line))
      .filter(Boolean);
    return lines[0] ?? text;
  }

  function extractExerciseName(button) {
    return extractRowName(button);
  }

  function isExerciseButton(button) {
    if (!isVisible(button)) return false;
    const name = extractExerciseName(button);
    if (!isPlausibleExerciseName(name)) return false;
    const heading = button.querySelector("h1, h2, h3, h4, h5, h6, [role='heading']");
    if (heading) return true;
    return button.childElementCount > 0;
  }

  function elementOverlapsListArea(rect, listRect, inputRect) {
    const zoneTop = Math.min(listRect.top, inputRect.bottom) - 4;
    const zoneBottom = Math.max(listRect.bottom, inputRect.bottom + 640);
    return (
      rect.bottom > zoneTop + 4 &&
      rect.top < zoneBottom - 4 &&
      rect.right > listRect.left - 48 &&
      rect.left < listRect.right + 48 &&
      rect.width > 0 &&
      rect.height > 0
    );
  }

  function isBelowSearchInput(rect, inputRect) {
    return rect.top >= inputRect.bottom - 12;
  }

  function descendantHasCleanerExerciseName(element, text) {
    return Array.from(element.querySelectorAll("*")).some((descendant) => {
      if (!isHTMLElement(descendant) || descendant === element) return false;
      if (!isVisible(descendant)) return false;
      const childName = extractRowName(descendant);
      if (!isPlausibleExerciseName(childName)) return false;
      if (childName === text) return true;
      if (nameIncludesTrailingLabel(text, childName)) return true;
      return false;
    });
  }

  function nameIncludesTrailingLabel(fullText, baseName) {
    if (!baseName || fullText === baseName) return false;
    if (fullText.startsWith(`${baseName} `)) return true;
    return fullText.startsWith(baseName) && fullText.length > baseName.length + 1;
  }

  function isLikelyMetadataRowElement(element) {
    const parent = element.parentElement;
    if (!isHTMLElement(parent)) return false;
    const siblings = Array.from(parent.children).filter(isHTMLElement);
    if (siblings.length < 2 || siblings[siblings.length - 1] !== element) return false;
    const primary = siblings[0];
    if (!isHTMLElement(primary)) return false;
    const primaryName = extractRowName(primary);
    return isPlausibleExerciseName(primaryName);
  }

  function collectVisibleTextRows(searchInput, scopeRoot, options) {
    const countOnly = Boolean(options?.countOnly);
    const maxSamples = options?.maxSamples ?? 500;
    if (!searchInput || !scopeRoot) return countOnly ? 0 : [];

    const inputRect = searchInput.getBoundingClientRect();
    const scopeRect = scopeRoot.getBoundingClientRect();
    const candidates = [];
    let count = 0;

    const elements = scopeRoot === document.body ? Array.from(document.body.querySelectorAll("*")) : [scopeRoot, ...Array.from(scopeRoot.querySelectorAll("*"))];

    for (const element of elements) {
      if (!isHTMLElement(element)) continue;
      if (SKIP_TAGS.has(element.tagName)) continue;
      if (element === searchInput || searchInput.contains(element)) continue;
      if (!isVisible(element)) continue;

      const rect = element.getBoundingClientRect();
      if (!elementOverlapsListArea(rect, scopeRect, inputRect)) continue;
      if (!isBelowSearchInput(rect, inputRect)) continue;
      if (rect.height < 6 || rect.height > 140) continue;
      if (rect.width < 28) continue;

      const name = extractRowName(element);
      if (!isPlausibleExerciseName(name)) continue;
      if (descendantHasCleanerExerciseName(element, name)) continue;
      if (isLikelyMetadataRowElement(element)) continue;

      count += 1;
      if (countOnly) continue;

      candidates.push({
        name,
        top: rect.top,
        left: rect.left,
        height: rect.height,
        domTag: element.tagName.toLowerCase(),
        role: normalizeWhitespace(element.getAttribute("role")) || undefined,
        ariaLabel: normalizeWhitespace(element.getAttribute("aria-label")) || undefined,
        dataAttributes: serializeDataAttributes(element),
      });
    }

    if (countOnly) return count;

    candidates.sort((left, right) => left.top - right.top || left.left - right.left || left.height - right.height);

    const seen = new Set();
    const rows = [];
    for (const candidate of candidates) {
      if (seen.has(candidate.name)) continue;
      seen.add(candidate.name);
      rows.push({
        name: candidate.name,
        top: candidate.top,
        left: candidate.left,
        domTag: candidate.domTag,
        role: candidate.role,
        ariaLabel: candidate.ariaLabel,
        dataAttributes: candidate.dataAttributes,
      });
      if (rows.length >= maxSamples) break;
    }

    return rows;
  }

  function findPickerRoot(searchInput) {
    if (!searchInput) return null;

    let best = null;
    let bestScore = -Infinity;
    let current = searchInput;
    let depth = 0;

    while (current && depth < 12) {
      const buttons = Array.from(current.querySelectorAll("button, [role='button']")).filter(isExerciseButton);
      const textRows = collectVisibleTextRows(searchInput, current, { countOnly: true });
      const rowCount = Math.max(buttons.length, textRows);
      const text = normalizeWhitespace(current.textContent);
      const score =
        rowCount * 8 +
        (text.includes("Exercise Library") ? 30 : 0) +
        (current.scrollHeight > current.clientHeight + 12 ? 14 : 0) +
        (rowCount >= 3 ? 20 : 0) -
        depth * 2;

      if (score > bestScore) {
        best = current;
        bestScore = score;
      }

      current = current.parentElement;
      depth += 1;
    }

    return bestScore >= 12 ? best : searchInput.parentElement;
  }

  function countContainedExerciseButtons(container) {
    return Array.from(container.querySelectorAll("button, [role='button']")).filter(isExerciseButton).length;
  }

  function countLikelyRows(container, searchInput) {
    const buttons = countContainedExerciseButtons(container);
    const textRows = collectVisibleTextRows(searchInput, container, { countOnly: true });
    return Math.max(buttons, textRows);
  }

  function findSearchResultsRoot(searchInput, searchTerm) {
    if (!searchInput) return null;

    const inputRect = searchInput.getBoundingClientRect();
    const activeTerm = normalizeWhitespace(searchTerm || getSearchInputValue(searchInput)).toLowerCase();
    let best = null;
    let bestScore = -Infinity;

    const candidates = Array.from(
      document.querySelectorAll("[role='listbox'], [role='list'], ul, ol, div, section"),
    );

    for (const candidate of candidates) {
      if (!isHTMLElement(candidate) || !isVisible(candidate)) continue;
      if (candidate === searchInput || searchInput.contains(candidate)) continue;
      if (containsShellCategoryLabels(candidate)) continue;

      const rect = candidate.getBoundingClientRect();
      const nearBelow =
        rect.top >= inputRect.bottom - 20 &&
        rect.top <= inputRect.bottom + 460 &&
        rect.left <= inputRect.right + 120 &&
        rect.right >= inputRect.left - 120;
      if (!nearBelow) continue;

      const rows = collectVisibleTextRows(searchInput, candidate).filter((row) =>
        rowMatchesSearchTerm(row.name, activeTerm),
      );
      if (rows.length === 0) continue;

      const isScrollable = candidate.scrollHeight > candidate.clientHeight + 12;
      const score =
        rows.length * 14 +
        (isScrollable ? 24 : 0) +
        (rect.top - inputRect.bottom < 180 ? 28 : 0) -
        Math.max(0, Math.abs(rect.left - inputRect.left) / 30);

      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }

    if (best) return best;

    let sibling = searchInput.parentElement;
    for (let depth = 0; depth < 6 && sibling; depth += 1) {
      const next = sibling.nextElementSibling;
      if (isHTMLElement(next) && isVisible(next) && !containsShellCategoryLabels(next)) {
        const rows = collectVisibleTextRows(searchInput, next).filter((row) =>
          rowMatchesSearchTerm(row.name, activeTerm),
        );
        if (rows.length > 0) return next;
      }
      sibling = sibling.parentElement;
    }

    return null;
  }

  function findListContainer(searchInput, root) {
    if (!searchInput || !root) return null;
    const inputRect = searchInput.getBoundingClientRect();

    let best = null;
    let bestScore = -Infinity;

    const candidates = [root, ...Array.from(root.querySelectorAll("*"))];
    for (const candidate of candidates) {
      if (!isVisible(candidate)) continue;
      const rowCount = countLikelyRows(candidate, searchInput);
      if (rowCount < 1) continue;

      const rect = candidate.getBoundingClientRect();
      const isScrollable = candidate.scrollHeight > candidate.clientHeight + 12;
      const belowInput = rect.bottom > inputRect.bottom && rect.top < inputRect.bottom + 320;
      const score =
        rowCount * 6 +
        (isScrollable ? 40 : 0) +
        (belowInput ? 16 : 0) +
        (candidate.contains(searchInput) ? 8 : 0) +
        (rowCount >= 3 ? 18 : 0) -
        Math.max(0, Math.abs(rect.top - inputRect.bottom) / 40);

      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }

    return bestScore >= 10 ? best : root;
  }

  function findScrollContainer(list, searchInput) {
    if (!list) return null;

    let best = list;
    let bestScroll = list.scrollHeight - list.clientHeight;
    let current = list;

    while (current && current !== document.body) {
      if (current.scrollHeight > current.clientHeight + 12) {
        const overflow = current.scrollHeight - current.clientHeight;
        if (overflow > bestScroll) {
          best = current;
          bestScroll = overflow;
        }
      }
      if (current === searchInput?.parentElement?.parentElement) break;
      current = current.parentElement;
    }

    return best;
  }

  function buildPickerState(searchTerm) {
    const searchInput = findSearchInput();
    const root = findPickerRoot(searchInput);
    const activeTerm = normalizeWhitespace(searchTerm || getSearchInputValue(searchInput));
    const searchResults = activeTerm ? findSearchResultsRoot(searchInput, activeTerm) : null;
    const list = searchResults || findListContainer(searchInput, root) || root;
    const scrollContainer = findScrollContainer(list, searchInput);
    return { searchInput, root, list, scrollContainer, searchResults, activeTerm };
  }

  function serializeDataAttributes(element) {
    const entries = Array.from(element.attributes)
      .filter((attribute) => attribute.name.startsWith("data-"))
      .slice(0, 20)
      .map((attribute) => [attribute.name, normalizeWhitespace(attribute.value).slice(0, 200)]);

    if (entries.length === 0) return undefined;
    return Object.fromEntries(entries);
  }

  function readButtonOptions(list) {
    const listRect = list.getBoundingClientRect();
    const options = Array.from(list.querySelectorAll("button, [role='button'], [role='option']"));
    const visible = [];

    for (const option of options) {
      if (!isExerciseButton(option) && option.getAttribute("role") !== "option") continue;
      const rect = option.getBoundingClientRect();
      const overlaps =
        rect.bottom > listRect.top + 4 &&
        rect.top < listRect.bottom - 4 &&
        rect.width > 0 &&
        rect.height > 0;
      if (!overlaps) continue;

      const name = extractExerciseName(option);
      if (!isPlausibleExerciseName(name)) continue;

      visible.push({
        name,
        top: rect.top,
        left: rect.left,
        domTag: option.tagName.toLowerCase(),
        role: normalizeWhitespace(option.getAttribute("role")) || undefined,
        ariaLabel: normalizeWhitespace(option.getAttribute("aria-label")) || undefined,
        dataAttributes: serializeDataAttributes(option),
      });
    }

    visible.sort((left, right) => left.top - right.top || left.left - right.left);
    return visible.map(({ top: _top, left: _left, ...option }) => option);
  }

  function mergeVisibleOptions(buttonOptions, textOptions) {
    const combined = [...buttonOptions, ...textOptions].sort(
      (left, right) => (left.top ?? 0) - (right.top ?? 0) || (left.left ?? 0) - (right.left ?? 0),
    );
    const merged = [];
    const seen = new Set();

    for (const option of combined) {
      const name = normalizeWhitespace(option.name);
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const { top: _top, left: _left, ...rest } = option;
      merged.push({ ...rest, name });
    }

    return merged;
  }

  function readVisibleOptions(searchInput, list, root, searchTerm) {
    const activeTerm = normalizeWhitespace(searchTerm || getSearchInputValue(searchInput));
    const resultsRoot = activeTerm ? findSearchResultsRoot(searchInput, activeTerm) : null;
    const scope = resultsRoot || list || root;
    if (!searchInput || !scope) return [];

    const buttonOptions = readButtonOptions(scope);
    const textOptions = collectVisibleTextRows(searchInput, scope).filter((row) =>
      activeTerm ? rowMatchesSearchTerm(row.name, activeTerm) : !isExcludedLabel(row.name),
    );
    return mergeVisibleOptions(buttonOptions, textOptions);
  }

  function collectCandidateRows(searchInput, searchTerm) {
    const activeTerm = normalizeWhitespace(searchTerm || getSearchInputValue(searchInput));
    const resultsRoot = findSearchResultsRoot(searchInput, activeTerm);
    const scope = resultsRoot || searchInput?.parentElement;
    if (!searchInput || !scope) return [];

    const rows = [];
    const elements = [scope, ...Array.from(scope.querySelectorAll("*"))];
    for (const element of elements) {
      if (!isHTMLElement(element) || !isVisible(element)) continue;
      const name = extractRowName(element);
      if (!isPlausibleExerciseName(name)) continue;
      if (activeTerm && !rowMatchesSearchTerm(name, activeTerm)) continue;
      if (descendantHasCleanerExerciseName(element, name)) continue;
      if (isLikelyMetadataRowElement(element)) continue;

      const rect = element.getBoundingClientRect();
      rows.push({
        text: name,
        tagName: element.tagName.toLowerCase(),
        role: normalizeWhitespace(element.getAttribute("role")) || undefined,
        ariaLabel: normalizeWhitespace(element.getAttribute("aria-label")) || undefined,
        className: normalizeWhitespace(element.className).slice(0, 120) || undefined,
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
      });
    }

    const seen = new Set();
    return rows
      .sort((left, right) => left.rect.y - right.rect.y || left.rect.x - right.rect.x)
      .filter((row) => {
        if (seen.has(row.text)) return false;
        seen.add(row.text);
        return true;
      })
      .slice(0, 40);
  }

  function collectDebugContainers(searchInput, root) {
    if (!searchInput) return [];

    const inputRect = searchInput.getBoundingClientRect();
    const scopes = root ? [root, ...Array.from(root.querySelectorAll("*"))] : Array.from(document.querySelectorAll("body *"));
    const samples = [];

    for (const candidate of scopes.slice(0, 250)) {
      if (!isHTMLElement(candidate) || !isVisible(candidate)) continue;
      const rect = candidate.getBoundingClientRect();
      const belowInput = rect.bottom > inputRect.bottom;
      const isScrollable = candidate.scrollHeight > candidate.clientHeight + 12;
      const rowCount = countLikelyRows(candidate, searchInput);
      if (!belowInput && !isScrollable && rowCount < 2) continue;

      const textSample = collectVisibleTextRows(searchInput, candidate)
        .slice(0, 8)
        .map((row) => row.name);

      samples.push({
        tagName: candidate.tagName.toLowerCase(),
        role: normalizeWhitespace(candidate.getAttribute("role")) || undefined,
        className: normalizeWhitespace(candidate.className).slice(0, 120) || undefined,
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        scrollHeight: candidate.scrollHeight,
        clientHeight: candidate.clientHeight,
        textSample,
      });
    }

    samples.sort((left, right) => right.textSample.length - left.textSample.length);
    return samples.slice(0, 12);
  }

  function setSearchValue(searchInput, value) {
    const target = extractInputLike(searchInput);

    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      const prototype =
        target instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
      descriptor?.set?.call(target, value);
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
      return target.value;
    }

    target.focus();
    if (target.isContentEditable) {
      target.textContent = value;
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
      return normalizeWhitespace(target.textContent);
    }

    if (target.getAttribute("role") === "combobox") {
      const nestedInput = target.querySelector("input, textarea");
      if (nestedInput instanceof HTMLInputElement || nestedInput instanceof HTMLTextAreaElement) {
        const prototype =
          nestedInput instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
        descriptor?.set?.call(nestedInput, value);
        nestedInput.dispatchEvent(new Event("input", { bubbles: true }));
        nestedInput.dispatchEvent(new Event("change", { bubbles: true }));
        return nestedInput.value;
      }
    }

    return null;
  }

  const state = buildPickerState(input.searchTerm);
  const { searchInput, root, list, scrollContainer } = state;
  const inspection = {
    pickerFound: Boolean(searchInput && list),
    inputFound: Boolean(searchInput),
    listFound: Boolean(list),
    inputPlaceholder: searchInput ? normalizeWhitespace(searchInput.getAttribute("placeholder")) || null : null,
    listTag: list ? list.tagName.toLowerCase() : null,
    listRole: list ? normalizeWhitespace(list.getAttribute("role")) || null : null,
  };

  if (input.action === "inspect") {
    return inspection;
  }

  if (input.action === "debug") {
    const inputRect = searchInput
      ? (() => {
          const rect = searchInput.getBoundingClientRect();
          return {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          };
        })()
      : null;

    const visibleTextSamples = searchInput && list
      ? readVisibleOptions(searchInput, list, root)
          .slice(0, 40)
          .map((row) => row.name)
      : [];

    return {
      pickerDetected: inspection.pickerFound,
      inputPlaceholder: inspection.inputPlaceholder,
      inputRect,
      candidateContainers: collectDebugContainers(searchInput, root),
      visibleTextSamples,
    };
  }

  if (input.action === "read" || input.action === "read-search-results") {
    const searchTerm = input.action === "read-search-results" ? input.searchTerm : undefined;
    const options = searchInput ? readVisibleOptions(searchInput, list, root, searchTerm) : [];
    return {
      ...inspection,
      optionCount: options.length,
      options,
      inputValue: getSearchInputValue(searchInput) || null,
    };
  }

  if (input.action === "debug-search-term") {
    const searchTerm = normalizeWhitespace(input.searchTerm || "");
    return {
      term: searchTerm,
      inputValueAfterTyping: getSearchInputValue(searchInput) || null,
      visibleTextSamples: searchInput
        ? readVisibleOptions(searchInput, list, root, searchTerm)
            .slice(0, 30)
            .map((row) => row.name)
        : [],
      candidateRows: collectCandidateRows(searchInput, searchTerm),
    };
  }

  if (input.action === "scroll" || input.action === "scroll-search-results") {
    const searchTerm = input.action === "scroll-search-results" ? input.searchTerm : undefined;
    const resultsRoot = searchTerm ? findSearchResultsRoot(searchInput, searchTerm) : null;
    const scrollTarget = resultsRoot || scrollContainer || list;
    if (!scrollTarget) {
      return {
        ...inspection,
        reachedEnd: true,
        scrollTopBefore: 0,
        scrollTopAfter: 0,
      };
    }

    const before = scrollTarget.scrollTop;
    const step = Math.max(120, Math.floor(scrollTarget.clientHeight * 0.82));
    scrollTarget.scrollTop = Math.min(scrollTarget.scrollHeight, scrollTarget.scrollTop + step);
    const after = scrollTarget.scrollTop;

    return {
      ...inspection,
      reachedEnd: after === before || after + scrollTarget.clientHeight >= scrollTarget.scrollHeight - 4,
      scrollTopBefore: before,
      scrollTopAfter: after,
    };
  }

  if (!searchInput) {
    return {
      ...inspection,
      applied: false,
      activeValue: null,
    };
  }

  const appliedValue = setSearchValue(searchInput, input.value ?? "");
  const scrollTarget = scrollContainer || list;
  if (scrollTarget) {
    scrollTarget.scrollTop = 0;
  }
  return {
    ...inspection,
    applied: appliedValue !== null,
    activeValue: appliedValue,
  };
}
