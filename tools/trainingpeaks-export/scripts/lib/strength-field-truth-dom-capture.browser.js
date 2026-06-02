function browserCaptureStrengthFieldTruthDom(input) {
  var checkpoint = String((input && input.checkpoint) || "");
  var targetExerciseNames = Array.isArray(input && input.targetExerciseNames) ? input.targetExerciseNames : [];
  var targetValueTokens = Array.isArray(input && input.targetValueTokens) ? input.targetValueTokens : [];

  function normalize(value, maxLength) {
    var limit = Number.isFinite(maxLength) ? maxLength : 220;
    return String(value == null ? "" : value)
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\/athletes\/\d+/gi, "/athletes/<ATHLETE_ID>")
      .replace(/\/workouts\/\d+/gi, "/workouts/<WORKOUT_ID>")
      .slice(0, limit);
  }

  function sanitizeUrl(inputUrl) {
    return normalize(inputUrl, 400)
      .replace(/\/exercises\/\d+/gi, "/exercises/<EXERCISE_ID>")
      .replace(/\bathleteId=\d+\b/gi, "athleteId=<ATHLETE_ID>")
      .replace(/\bworkoutId=\d+\b/gi, "workoutId=<WORKOUT_ID>")
      .replace(/\bexerciseId=\d+\b/gi, "exerciseId=<EXERCISE_ID>");
  }

  function rectOf(node) {
    if (!node || !(node instanceof Element)) return undefined;
    var rect = node.getBoundingClientRect();
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  }

  function isVisible(node) {
    if (!node || !(node instanceof Element)) return false;
    var rect = node.getBoundingClientRect();
    var style = window.getComputedStyle(node);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }

  function textSampleFrom(root, limit) {
    var maxCount = Number.isFinite(limit) ? limit : 10;
    var values = [];
    var seen = new Set();
    var nodes = root.querySelectorAll("h1,h2,h3,h4,h5,h6,button,label,span,div,p,input,textarea,select");
    for (var i = 0; i < nodes.length; i += 1) {
      var node = nodes[i];
      if (!isVisible(node)) continue;
      var text =
        node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement
          ? normalize(node.value || node.placeholder || node.getAttribute("aria-label") || "", 100)
          : normalize(node.textContent, 100);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      values.push(text);
      if (values.length >= maxCount) break;
    }
    return values;
  }

  function parentChain(node, maxDepth) {
    var limit = Number.isFinite(maxDepth) ? maxDepth : 8;
    if (!node || !(node instanceof Element)) return undefined;
    var chain = [];
    var current = node;
    var depth = 0;
    while (current && depth < limit) {
      chain.push({
        depth: depth,
        tag: current.tagName.toLowerCase(),
        id: normalize(current.id, 80) || undefined,
        className: normalize(current.className, 120) || undefined,
        role: normalize(current.getAttribute("role"), 60) || undefined,
        ariaLabel: normalize(current.getAttribute("aria-label"), 120) || undefined,
        dataTestId: normalize(current.getAttribute("data-testid"), 120) || undefined,
        textSample: normalize(current.textContent, 140) || undefined,
        rect: rectOf(current),
      });
      current = current.parentElement;
      depth += 1;
    }
    return chain;
  }

  function labelTextFor(node) {
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement) {
      var labels = Array.from(node.labels || [])
        .map(function (label) {
          return normalize(label.textContent, 120);
        })
        .filter(Boolean);
      if (labels.length > 0) return labels.join(" | ");
    }
    var labelledBy = node.getAttribute("aria-labelledby");
    if (labelledBy) {
      var ids = labelledBy.split(/\s+/);
      var text = [];
      for (var i = 0; i < ids.length; i += 1) {
        var entry = document.getElementById(ids[i]);
        if (!entry) continue;
        var normalized = normalize(entry.textContent, 120);
        if (normalized) text.push(normalized);
      }
      if (text.length > 0) return text.join(" | ");
    }
    var nearestLabel = node.closest("label");
    return nearestLabel ? normalize(nearestLabel.textContent, 120) || undefined : undefined;
  }

  function nearestTextScope(node) {
    return (
      node.closest("label,div,section,article,li,tr,td,th,[role='group'],[role='row']") || node.parentElement || node
    );
  }

  function toControl(node, index) {
    var tag = node.tagName.toLowerCase();
    var value =
      node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement
        ? normalize(node.value, 120)
        : normalize(node.textContent, 120);
    return {
      index: index,
      tag: tag,
      type: node instanceof HTMLInputElement ? normalize(node.type, 40) || undefined : tag === "select" ? "select" : tag,
      value: value || undefined,
      placeholder:
        node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement
          ? normalize(node.placeholder, 120) || undefined
          : undefined,
      ariaLabel: normalize(node.getAttribute("aria-label"), 120) || undefined,
      title: normalize(node.getAttribute("title"), 120) || undefined,
      nearbyText: normalize(nearestTextScope(node).textContent, 180) || undefined,
      labelText: labelTextFor(node),
      rect: rectOf(node),
      parentChain: parentChain(node),
    };
  }

  function collectControls(root, selector, limit) {
    var maxCount = Number.isFinite(limit) ? limit : 80;
    var nodes = Array.from(root.querySelectorAll(selector)).filter(function (node) {
      return isVisible(node);
    });
    return nodes.slice(0, maxCount).map(function (node, index) {
      return toControl(node, index);
    });
  }

  function controlScopeFor(node, dialog) {
    var current = node;
    while (current && current !== dialog) {
      var controlCount = current.querySelectorAll("input,textarea,select,[contenteditable='true'],button,[role='button']")
        .length;
      if (controlCount > 0) return current;
      current = current.parentElement;
    }
    return node.closest("div,section,article,li,[role='group'],[role='row']") || node;
  }

  var visibleDialogs = Array.from(document.querySelectorAll('[role="dialog"]')).filter(function (dialog) {
    return isVisible(dialog);
  });
  var dialogs = [];
  var valueSignalControls = [];

  for (var dialogIndex = 0; dialogIndex < visibleDialogs.length; dialogIndex += 1) {
    var dialog = visibleDialogs[dialogIndex];
    var inputs = collectControls(dialog, "input,select", 80);
    var textareas = collectControls(dialog, "textarea,[contenteditable='true']", 40);
    var buttons = collectControls(dialog, "button,[role='button']", 40);
    var exactExerciseNameOccurrences = [];
    var exactValueTokenOccurrences = [];
    var possibleExerciseCardMap = new Map();

    function addValueSignal(control) {
      var haystack = normalize(
        [
          control.value || "",
          control.placeholder || "",
          control.ariaLabel || "",
          control.labelText || "",
          control.nearbyText || "",
        ].join(" "),
        500
      ).toLowerCase();
      for (var tokenIndex = 0; tokenIndex < targetValueTokens.length; tokenIndex += 1) {
        if (haystack.includes(String(targetValueTokens[tokenIndex]).toLowerCase())) {
          valueSignalControls.push(control);
          return;
        }
      }
    }

    for (var i = 0; i < inputs.length; i += 1) addValueSignal(inputs[i]);
    for (var j = 0; j < textareas.length; j += 1) addValueSignal(textareas[j]);

    var candidateElements = Array.from(
      dialog.querySelectorAll("input,textarea,select,button,label,span,div,p,h1,h2,h3,h4,h5,h6")
    ).filter(function (node) {
      return isVisible(node);
    });

    function pushOccurrence(sourceNode, name, source, value, target) {
      var scope = controlScopeFor(sourceNode, dialog);
      var scopeRect = scope.getBoundingClientRect();
      var scopeKey =
        String(name) +
        "::" +
        String(source) +
        "::" +
        String(Math.round(scopeRect.x)) +
        "::" +
        String(Math.round(scopeRect.y)) +
        "::" +
        String(Math.round(scopeRect.width)) +
        "::" +
        String(Math.round(scopeRect.height));
      var occurrence = {
        name: String(name),
        source: source,
        value: normalize(value, 160),
        rect: rectOf(sourceNode),
        parentChain: parentChain(sourceNode),
        nearbyInputs: collectControls(scope, "input,select,textarea,[contenteditable='true']", 8),
        nearbyButtons: collectControls(scope, "button,[role='button']", 8),
      };
      if (target === "exercise") {
        exactExerciseNameOccurrences.push(occurrence);
      } else {
        exactValueTokenOccurrences.push(occurrence);
      }
      if (!possibleExerciseCardMap.has(scopeKey)) {
        var controls = collectControls(scope, "input,select", 12).concat(
          collectControls(scope, "textarea,[contenteditable='true']", 8)
        );
        possibleExerciseCardMap.set(scopeKey, {
          exactName: String(name),
          evidenceSource: String(source),
          rect: rectOf(scope),
          textSample: textSampleFrom(scope, 12),
          inputValues: controls
            .map(function (control) {
              return control.value;
            })
            .filter(Boolean)
            .slice(0, 12),
          controls: controls,
          parentChain: parentChain(scope),
        });
      }
    }

    for (var nodeIndex = 0; nodeIndex < candidateElements.length; nodeIndex += 1) {
      var node = candidateElements[nodeIndex];
      var text = normalize(node.textContent, 200);
      var ariaLabel = normalize(node.getAttribute("aria-label"), 160);
      var placeholder = normalize(node.getAttribute("placeholder"), 160);
      var currentValue =
        node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement
          ? normalize(node.value, 160)
          : "";

      for (var nameIndex = 0; nameIndex < targetExerciseNames.length; nameIndex += 1) {
        var name = String(targetExerciseNames[nameIndex]);
        var loweredName = name.toLowerCase();
        if (text && text.toLowerCase().includes(loweredName)) {
          pushOccurrence(node, name, "text", text, "exercise");
        }
        if (currentValue && currentValue.toLowerCase().includes(loweredName)) {
          pushOccurrence(node, name, node instanceof HTMLTextAreaElement ? "textareaValue" : "inputValue", currentValue, "exercise");
        }
        if (ariaLabel && ariaLabel.toLowerCase().includes(loweredName)) {
          pushOccurrence(node, name, "ariaLabel", ariaLabel, "exercise");
        }
        if (placeholder && placeholder.toLowerCase().includes(loweredName)) {
          pushOccurrence(node, name, "placeholder", placeholder, "exercise");
        }
      }

      for (var tokenIndex = 0; tokenIndex < targetValueTokens.length; tokenIndex += 1) {
        var token = String(targetValueTokens[tokenIndex]);
        var loweredToken = token.toLowerCase();
        if (text && text.toLowerCase().includes(loweredToken)) {
          pushOccurrence(node, token, "text", text, "value");
        }
        if (currentValue && currentValue.toLowerCase().includes(loweredToken)) {
          pushOccurrence(node, token, node instanceof HTMLTextAreaElement ? "textareaValue" : "inputValue", currentValue, "value");
        }
        if (ariaLabel && ariaLabel.toLowerCase().includes(loweredToken)) {
          pushOccurrence(node, token, "ariaLabel", ariaLabel, "value");
        }
        if (placeholder && placeholder.toLowerCase().includes(loweredToken)) {
          pushOccurrence(node, token, "placeholder", placeholder, "value");
        }
      }
    }

    dialogs.push({
      index: dialogIndex,
      rect: rectOf(dialog) || { x: 0, y: 0, width: 0, height: 0 },
      textSample: textSampleFrom(dialog, 16),
      inputs: inputs,
      textareas: textareas,
      buttons: buttons,
      exactExerciseNameOccurrences: exactExerciseNameOccurrences,
      exactValueTokenOccurrences: exactValueTokenOccurrences,
      possibleExerciseCards: Array.from(possibleExerciseCardMap.values()).slice(0, 24),
    });
  }

  var active = document.activeElement instanceof Element ? document.activeElement : null;
  var activeElement = active
    ? {
        tag: active.tagName.toLowerCase(),
        type: active instanceof HTMLInputElement ? normalize(active.type, 40) || undefined : undefined,
        value:
          active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement
            ? normalize(active.value, 120) || undefined
            : undefined,
        placeholder:
          active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
            ? normalize(active.placeholder, 120) || undefined
            : undefined,
        ariaLabel: normalize(active.getAttribute("aria-label"), 120) || undefined,
        title: normalize(active.getAttribute("title"), 120) || undefined,
        textSample: normalize(active.textContent, 120) || undefined,
        rect: rectOf(active),
        parentChain: parentChain(active),
      }
    : undefined;

  var focusedControl =
    active && (active.matches("input,select,textarea,[contenteditable='true']") || active.getAttribute("role") === "textbox")
      ? toControl(active, 0)
      : undefined;

  return {
    checkpoint: checkpoint,
    url: sanitizeUrl(window.location.href),
    timestamp: new Date().toISOString(),
    targetExerciseNames: targetExerciseNames.slice(),
    dialogFound: dialogs.length > 0,
    dialogs: dialogs,
    activeElement: activeElement,
    focusedControl: focusedControl,
    valueSignalControls: valueSignalControls.slice(0, 40),
  };
}
