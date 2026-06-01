/* eslint-disable -- browser-only script executed via page.evaluate + new Function */
// Browser-only visual field evidence collector for TrainingPeaks strength builder.
// Loaded as plain text to avoid tsx/esbuild helper injection in browser context.
function browserCollectVisualFieldEvidence(input) {
  var entries = Array.isArray(input && input.entries) ? input.entries : [];

  function normalize(value) {
    return String(value == null ? "" : value)
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function includes(haystack, needle) {
    var normalizedNeedle = normalize(needle);
    if (!normalizedNeedle) return false;
    return normalize(haystack).includes(normalizedNeedle);
  }

  function hasDurationSemantics(haystack, expectedSecondsRaw) {
    var expectedRaw = String(expectedSecondsRaw == null ? "" : expectedSecondsRaw).trim();
    if (!expectedRaw) return true;
    var expectedSeconds = Number(expectedRaw);
    if (!Number.isFinite(expectedSeconds) || expectedSeconds <= 0) {
      return includes(haystack, expectedRaw);
    }
    var mm = Math.floor(expectedSeconds / 60);
    var ss = expectedSeconds % 60;
    var ssPadded = String(ss).padStart(2, "0");
    var mmPadded = String(mm).padStart(2, "0");
    var variants = [
      String(expectedSeconds),
      expectedSeconds + " sec",
      expectedSeconds + " secs",
      expectedSeconds + " second",
      expectedSeconds + " seconds",
      expectedSeconds + "s",
      mm + ":" + ssPadded,
      mmPadded + ":" + ssPadded,
      "00:" + mmPadded + ":" + ssPadded,
    ];
    var normalizedHaystack = normalize(haystack);
    for (var index = 0; index < variants.length; index += 1) {
      if (normalizedHaystack.includes(normalize(variants[index]))) {
        return true;
      }
    }
    return false;
  }

  function compactText(value) {
    return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  }

  function collectElementEvidence(element) {
    var parts = [];
    var text = compactText(element.textContent);
    if (text) parts.push(text);

    var fields = element.querySelectorAll("input, textarea, [contenteditable='true'], [role='textbox']");
    for (var index = 0; index < fields.length; index += 1) {
      var field = fields[index];
      var value = "";
      if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
        value = compactText(field.value);
      } else {
        value = compactText(field.textContent);
      }
      var ariaLabel = compactText(field.getAttribute("aria-label"));
      var placeholder = compactText(field.getAttribute("placeholder"));
      var title = compactText(field.getAttribute("title"));
      if (value) parts.push(value);
      if (ariaLabel) parts.push(ariaLabel);
      if (placeholder) parts.push(placeholder);
      if (title) parts.push(title);
    }

    return parts.join(" | ");
  }

  function findExerciseHost(exerciseName) {
    var normalizedName = normalize(exerciseName);
    if (!normalizedName) return null;
    var candidates = Array.from(
      document.querySelectorAll("section,article,div,li,tr,[role='row'],[role='group'],[data-testid]")
    );
    var best = null;
    var bestScore = -Infinity;
    for (var index = 0; index < candidates.length; index += 1) {
      var node = candidates[index];
      var text = compactText(node.textContent);
      if (!includes(text, exerciseName)) continue;
      var evidence = collectElementEvidence(node);
      var score = 0;
      if (includes(evidence, exerciseName)) score += 30;
      if (node.querySelector("input, textarea, [contenteditable='true'], [role='textbox']")) score += 20;
      score -= Math.min(text.length, 2000) / 100;
      if (score > bestScore) {
        best = node;
        bestScore = score;
      }
    }
    return best;
  }

  var details = [];
  for (var index = 0; index < entries.length; index += 1) {
    var entry = entries[index] || {};
    var name = String(entry.name == null ? "" : entry.name);
    var host = findExerciseHost(name);
    var evidenceText = collectElementEvidence(host || document.body);
    details.push({
      name: name,
      setsVisible: includes(evidenceText, entry.sets || ""),
      repsVisible: entry.reps ? includes(evidenceText, entry.reps) : true,
      durationVisible: hasDurationSemantics(evidenceText, entry.durationSeconds),
      noteVisible: entry.coachNote ? includes(evidenceText, entry.coachNote) : true,
    });
  }

  return details;
}
