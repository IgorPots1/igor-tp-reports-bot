export type StrengthTemplateExercise = {
  targetNames: string[];
  sets: string;
  reps: string;
  notes?: string;
};

export type StrengthTemplateBlock = {
  name: string;
  exercises: StrengthTemplateExercise[];
};

export type StrengthTemplate = {
  id: string;
  title: string;
  purpose: string;
  estimatedDurationMinutes: string;
  safetyNotes?: string[];
  blocks: StrengthTemplateBlock[];
};

export const STRENGTH_TEMPLATES: StrengthTemplate[] = [
  {
    id: "strength_for_runners_base",
    title: "Base Strength for Runners",
    purpose: "General strength for runners. No rehab claims.",
    estimatedDurationMinutes: "30–40",
    blocks: [
      {
        name: "Main circuit",
        exercises: [
          {
            targetNames: ["Glute Bridge", "Banded Glute Bridge"],
            sets: "2–3",
            reps: "12–15",
            notes: "Focus on glute activation at the top.",
          },
          {
            targetNames: ["Romanian Deadlift"],
            sets: "2–3",
            reps: "8–10",
            notes: "Light to moderate load; hinge with neutral spine.",
          },
          {
            targetNames: ["Split Squat"],
            sets: "2",
            reps: "8 each side",
            notes: "Controlled descent; knee tracks over toes.",
          },
          {
            targetNames: ["Step Up"],
            sets: "2",
            reps: "10 each side",
            notes: "Use a stable box or bench.",
          },
          {
            targetNames: ["Calf Raise"],
            sets: "2–3",
            reps: "15–20",
            notes: "Full range; pause at top.",
          },
          {
            targetNames: ["Side Plank"],
            sets: "2",
            reps: "30–45 sec each side",
            notes: "Keep hips stacked.",
          },
        ],
      },
    ],
  },
  {
    id: "knee_support_runner_prehab",
    title: "Knee Support / Runner Prehab",
    purpose: "Gentle knee-support and runner prehab. Not medical treatment.",
    estimatedDurationMinutes: "20–25",
    safetyNotes: [
      "No sharp pain during any exercise.",
      "Stop if pain increases during or after the session.",
      "This template is not a substitute for medical care.",
    ],
    blocks: [
      {
        name: "Prehab circuit",
        exercises: [
          {
            targetNames: ["Banded Clam Shell"],
            sets: "2",
            reps: "15 each side",
            notes: "Slow and controlled.",
          },
          {
            targetNames: ["Banded Glute Bridge"],
            sets: "2",
            reps: "12–15",
            notes: "Band above knees; push knees out slightly.",
          },
          {
            targetNames: ["Wall Squat", "Air Squat"],
            sets: "2",
            reps: "10–12",
            notes: "Pain-free range only.",
          },
          {
            targetNames: ["Step Up"],
            sets: "2",
            reps: "8 each side",
            notes: "Low box height; control the descent.",
          },
          {
            targetNames: ["Calf Raise"],
            sets: "2",
            reps: "15",
            notes: "Both straight-knee and bent-knee if tolerated.",
          },
          {
            targetNames: ["Side Plank"],
            sets: "2",
            reps: "20–30 sec each side",
            notes: "Modify on knees if needed.",
          },
        ],
      },
    ],
  },
];

export function getStrengthTemplateById(templateId: string): StrengthTemplate | undefined {
  return STRENGTH_TEMPLATES.find((template) => template.id === templateId);
}
