/* eslint-disable -- browser-only script executed via locator.evaluate + new Function */
// Loaded as plain text to avoid tsx/esbuild helper injection in browser context.
function browserStrengthFieldNormalize(value) {
  return String(value == null ? "" : value)
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function browserStrengthFieldCompact(value) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
}

function browserStrengthTokenMatch(value, tokens) {
  var normalized = browserStrengthFieldNormalize(value);
  if (!normalized) return false;
  for (var index = 0; index < tokens.length; index += 1) {
    if (normalized.includes(browserStrengthFieldNormalize(tokens[index]))) {
      return true;
    }
  }
  return false;
}

function browserStrengthCollectCandidates(host, payload) {
  var controls = Array.from(
    host.querySelectorAll("input, textarea, [contenteditable='true'], [role='textbox']")
  );
  var scored = [];
  for (var index = 0; index < controls.length; index += 1) {
    var node = controls[index];
    var tag = node.tagName.toLowerCase();
    var type = tag === "input" ? browserStrengthFieldNormalize(node.type || "text") : "";
    if (
      payload.inputTypeAllowList &&
      payload.inputTypeAllowList.length > 0 &&
      tag === "input" &&
      payload.inputTypeAllowList.indexOf(type || "text") === -1
    ) {
      continue;
    }
    if (!payload.allowTextarea && tag === "textarea") continue;
    if (!payload.allowContentEditable && node.getAttribute("contenteditable") === "true") continue;
    var ariaLabel = browserStrengthFieldCompact(node.getAttribute("aria-label"));
    var placeholder = browserStrengthFieldCompact(node.getAttribute("placeholder"));
    var title = browserStrengthFieldCompact(node.getAttribute("title"));
    var ownValue =
      "value" in node
        ? browserStrengthFieldCompact(node.value)
        : browserStrengthFieldCompact(node.textContent);
    var containerText = browserStrengthFieldCompact(
      (node.closest("label, td, th, div, section, article, li, tr") || host).textContent
    );
    var signatures = [ariaLabel, placeholder, title, containerText].filter(Boolean).join(" | ");
    var score = 0;
    if (browserStrengthTokenMatch(ariaLabel, payload.ariaTokens || [])) score += 50;
    if (browserStrengthTokenMatch(placeholder, payload.placeholderTokens || [])) score += 45;
    if (browserStrengthTokenMatch(signatures, payload.labelTokens || [])) score += 35;
    if (browserStrengthTokenMatch(containerText, payload.labelTokens || [])) score += 25;
    if (payload.kind === "coachNote" && tag === "textarea") score += 20;
    if (payload.kind !== "coachNote" && tag === "input") score += 10;
    if (ownValue && browserStrengthTokenMatch(ownValue, ["hh:mm:ss"]) && payload.kind !== "duration") score -= 60;
    if (score <= 0) continue;
    scored.push({
      index: index,
      score: score,
      tag: tag,
      type: type,
      ariaLabel: ariaLabel,
      placeholder: placeholder,
      title: title,
      containerText: containerText.slice(0, 220),
    });
  }
  scored.sort(function (left, right) {
    return right.score - left.score;
  });
  return {
    controls: controls,
    scored: scored,
  };
}

function browserWriteSemanticField(host, payload) {
  var collection = browserStrengthCollectCandidates(host, payload);
  var top = collection.scored[0];
  if (!top) {
    return { ok: false, detail: "No semantic field candidate found." };
  }
  var target = collection.controls[top.index];
  var asInput = target;
  target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  target.focus();
  if ("value" in asInput) {
    asInput.value = "";
    asInput.dispatchEvent(new Event("input", { bubbles: true }));
    asInput.value = payload.value;
    asInput.dispatchEvent(new Event("input", { bubbles: true }));
    asInput.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    target.textContent = payload.value;
    target.dispatchEvent(new InputEvent("input", { bubbles: true }));
  }
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
  target.blur();
  var readBack =
    "value" in asInput
      ? browserStrengthFieldCompact(asInput.value)
      : browserStrengthFieldCompact(target.textContent);
  return {
    ok: true,
    readBack: readBack,
    selectorHint: top.tag + ":" + (top.type || "n/a") + ":" + (top.ariaLabel || top.placeholder || "no-label"),
  };
}

function browserIsValueVisible(host, payload) {
  var expectedVariants = Array.isArray(payload.expectedVariants) ? payload.expectedVariants : [];
  var hostText = browserStrengthFieldCompact(host.textContent);
  var haystackParts = [];
  if (hostText) haystackParts.push(hostText);
  var controls = Array.from(
    host.querySelectorAll("input, textarea, [contenteditable='true'], [role='textbox']")
  );
  for (var index = 0; index < controls.length; index += 1) {
    var node = controls[index];
    var value =
      "value" in node
        ? browserStrengthFieldCompact(node.value)
        : browserStrengthFieldCompact(node.textContent);
    if (value) haystackParts.push(value);
  }
  var haystack = browserStrengthFieldNormalize(haystackParts.join(" | "));
  for (var variantIndex = 0; variantIndex < expectedVariants.length; variantIndex += 1) {
    var variant = browserStrengthFieldNormalize(expectedVariants[variantIndex]);
    if (!variant) continue;
    if (haystack.includes(variant)) return true;
  }
  return false;
}

function browserStrengthFieldAction(element, input) {
  if (!element || !(element instanceof HTMLElement)) {
    return { ok: false, detail: "Host element is missing." };
  }
  if (!input || typeof input !== "object") {
    return { ok: false, detail: "Input payload is missing." };
  }
  if (input.action === "write") {
    return browserWriteSemanticField(element, input.payload || {});
  }
  if (input.action === "isVisible") {
    return {
      ok: true,
      visible: browserIsValueVisible(element, input.payload || {}),
    };
  }
  if (input.action === "candidates") {
    var collection = browserStrengthCollectCandidates(element, input.payload || {});
    return {
      ok: true,
      candidates: collection.scored,
    };
  }
  return { ok: false, detail: "Unsupported action: " + String(input.action || "") };
}
