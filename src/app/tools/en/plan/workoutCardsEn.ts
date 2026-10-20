// English workout cards for the pace calculator. The maths is shared with the
// Russian tool (../../plan/vdot.ts): VDOT by Daniels, zones by Friel from FTPa.
// Only the texts differ, and ranges use a plain hyphen instead of a dash.

import {
  FRIEL_ZONES,
  formatPace,
  ftpaSecPerKm,
  vdotFromRace,
  zonePaceRange,
  type RaceDistance,
  type WorkoutCard,
} from "../../plan/vdot";

function range(r: [number, number]): string {
  return `${formatPace(r[0])}-${formatPace(r[1])} /km`;
}

export function buildWorkoutCardsEn(meters: RaceDistance, seconds: number): WorkoutCard[] {
  const vdot = vdotFromRace(meters, seconds);
  const ftpa = ftpaSecPerKm(vdot);

  return [
    {
      id: "easy",
      title: "Easy run",
      paceRange: range(zonePaceRange(ftpa, FRIEL_ZONES.easy.fast, FRIEL_ZONES.easy.slow)),
      format: "30-60 min without stopping, at a pace where you can talk.",
      description: "You can speak in full sentences. This is the base of your week.",
    },
    {
      id: "tempo",
      title: "Tempo run",
      paceRange: range(zonePaceRange(ftpa, FRIEL_ZONES.tempo.fast, FRIEL_ZONES.tempo.slow)),
      format: "One block of 15-30 min without stopping.",
      workVolume: "15-30 min",
      description: "Steady running in one block: hard, but under control.",
    },
    {
      id: "long_intervals",
      title: "Long intervals",
      paceRange: range(zonePaceRange(ftpa, FRIEL_ZONES.longIntervals.fast, FRIEL_ZONES.longIntervals.slow)),
      format: "Reps of 4-12 min, with 1-1.5 min of easy jogging between.",
      workVolume: "30-40 min",
      description: "Threshold pace in reps, a little faster than a steady tempo run.",
    },
    {
      id: "short_intervals",
      title: "Short intervals",
      paceRange: range(zonePaceRange(ftpa, FRIEL_ZONES.shortIntervals.fast, FRIEL_ZONES.shortIntervals.slow)),
      format: "Reps of 1-4 min, with easy jogging about as long as the rep.",
      workVolume: "12-18 min",
      description:
        "Fast and hard, close to your max, where breathing gets heavy. They teach your body to use more oxygen.",
    },
  ];
}
