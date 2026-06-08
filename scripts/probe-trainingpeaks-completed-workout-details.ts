import {
  parseProbeCliArgs,
  runTrainingPeaksCompletedWorkoutDetailsProbe,
} from "@/features/trainingpeaks/trainingpeaks-completed-workout-details-probe";

async function main(): Promise<void> {
  const cli = parseProbeCliArgs(process.argv.slice(2));
  if (cli.help) {
    console.log("TrainingPeaks completed workout details probe (read-only)");
    console.log("");
    console.log("Usage:");
    console.log(
      "  npm run audit:trainingpeaks-completed-workout-details-probe -- --student-id=<uuid> --date=YYYY-MM-DD [--workout-id=<id>]"
    );
    console.log(
      "  npm run audit:trainingpeaks-completed-workout-details-probe -- --athlete-id=<id> --date=YYYY-MM-DD [--workout-id=<id>]"
    );
    return;
  }

  const result = await runTrainingPeaksCompletedWorkoutDetailsProbe(cli);
  console.log("[tp-completed-workout-details-probe] PASS");
  console.log(`[tp-completed-workout-details-probe] report_dir=${result.reportDir}`);
  console.log(`[tp-completed-workout-details-probe] details=${result.outputFiles.detailsPath}`);
  console.log(`[tp-completed-workout-details-probe] summary=${result.outputFiles.summaryPath}`);
  console.log(`[tp-completed-workout-details-probe] mode=${result.probe.source.mode}`);
  console.log(
    `[tp-completed-workout-details-probe] avg_pace=${result.probe.dataAvailability.hasAveragePace} avg_hr=${result.probe.dataAvailability.hasAverageHeartRate} laps=${result.probe.dataAvailability.hasLaps} interval_actuals=${result.probe.dataAvailability.hasIntervalActuals}`
  );
}

main().catch((error) => {
  console.error("[tp-completed-workout-details-probe] FAIL");
  console.error(error);
  process.exitCode = 1;
});
