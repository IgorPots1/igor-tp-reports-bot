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

  function extractExerciseName(button) {
    const heading = button.querySelector("h1, h2, h3, h4, h5, h6, [role='heading']");
    if (heading) {
      const text = normalizeWhitespace(heading.innerText || heading.textContent);
      if (text) return text;
    }

    const ariaLabel = normalizeWhitespace(button.getAttribute("aria-label"));
    if (ariaLabel) {
      return ariaLabel.split(/\s{2,}|\n/)[0]?.trim() ?? ariaLabel;
    }

    const text = normalizeWhitespace(button.innerText || button.textContent);
    return text.split("\n")[0]?.trim() ?? text;
  }

  function isExerciseButton(button) {
    if (!isVisible(button)) return false;
    const name = extractExerciseName(button);
    if (!name || EXCLUDED_BUTTON_LABELS.has(name)) return false;
    if (name.length < 2) return false;
    const heading = button.querySelector("h1, h2, h3, h4, h5, h6, [role='heading']");
    if (heading) return true;
    return button.childElementCount > 0;
  }

  function findPickerRoot(searchInput) {
    if (!searchInput) return null;

    let best = null;
    let bestScore = -Infinity;
    let current = searchInput;
    let depth = 0;

    while (current && depth < 10) {
      const buttons = Array.from(current.querySelectorAll("button, [role='button']")).filter(isExerciseButton);
      const text = normalizeWhitespace(current.textContent);
      const score =
        buttons.length * 8 +
        (text.includes("Exercise Library") ? 30 : 0) +
        (current.scrollHeight > current.clientHeight + 12 ? 12 : 0) -
        depth * 2;

      if (score > bestScore) {
        best = current;
        bestScore = score;
      }

      current = current.parentElement;
      depth += 1;
    }

    return bestScore >= 16 ? best : searchInput.parentElement;
  }

  function countContainedExerciseButtons(container) {
    return Array.from(container.querySelectorAll("button, [role='button']")).filter(isExerciseButton).length;
  }

  function findListContainer(searchInput, root) {
    if (!searchInput || !root) return null;
    const inputRect = searchInput.getBoundingClientRect();

    let best = null;
    let bestScore = -Infinity;

    const candidates = [root, ...Array.from(root.querySelectorAll("*"))];
    for (const candidate of candidates) {
      if (!isVisible(candidate)) continue;
      const exerciseCount = countContainedExerciseButtons(candidate);
      if (exerciseCount < 3) continue;
      const rect = candidate.getBoundingClientRect();
      const isScrollable = candidate.scrollHeight > candidate.clientHeight + 12;
      const belowInput = rect.bottom > inputRect.bottom && rect.top < inputRect.bottom + 240;
      const score =
        exerciseCount * 6 +
        (isScrollable ? 35 : 0) +
        (belowInput ? 12 : 0) +
        (candidate.contains(searchInput) ? 6 : 0) -
        Math.max(0, Math.abs(rect.top - inputRect.bottom) / 40);

      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }

    return bestScore >= 18 ? best : root;
  }

  function buildPickerState() {
    const searchInput = findSearchInput();
    const root = findPickerRoot(searchInput);
    const list = findListContainer(searchInput, root);
    return { searchInput, root, list };
  }

  function serializeDataAttributes(element) {
    const entries = Array.from(element.attributes)
      .filter((attribute) => attribute.name.startsWith("data-"))
      .slice(0, 20)
      .map((attribute) => [attribute.name, normalizeWhitespace(attribute.value).slice(0, 200)]);

    if (entries.length === 0) return undefined;
    return Object.fromEntries(entries);
  }

  function readVisibleOptions(list) {
    const listRect = list.getBoundingClientRect();
    const options = Array.from(list.querySelectorAll("button, [role='button']"));
    const visible = [];

    for (const option of options) {
      if (!isExerciseButton(option)) continue;
      const rect = option.getBoundingClientRect();
      const overlaps =
        rect.bottom > listRect.top + 4 &&
        rect.top < listRect.bottom - 4 &&
        rect.width > 0 &&
        rect.height > 0;
      if (!overlaps) continue;

      const name = extractExerciseName(option);
      if (!name) continue;

      visible.push({
        name,
        domTag: option.tagName.toLowerCase(),
        role: normalizeWhitespace(option.getAttribute("role")) || undefined,
        ariaLabel: normalizeWhitespace(option.getAttribute("aria-label")) || undefined,
        dataAttributes: serializeDataAttributes(option),
      });
    }

    return visible;
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

  const { searchInput, list } = buildPickerState();
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

  if (input.action === "read") {
    const options = list ? readVisibleOptions(list) : [];
    return {
      ...inspection,
      optionCount: options.length,
      options,
    };
  }

  if (input.action === "scroll") {
    if (!list) {
      return {
        ...inspection,
        reachedEnd: true,
        scrollTopBefore: 0,
        scrollTopAfter: 0,
      };
    }

    const before = list.scrollTop;
    const step = Math.max(120, Math.floor(list.clientHeight * 0.82));
    list.scrollTop = Math.min(list.scrollHeight, list.scrollTop + step);
    const after = list.scrollTop;

    return {
      ...inspection,
      reachedEnd: after === before || after + list.clientHeight >= list.scrollHeight - 4,
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
  if (list) {
    list.scrollTop = 0;
  }
  return {
    ...inspection,
    applied: appliedValue !== null,
    activeValue: appliedValue,
  };
}
