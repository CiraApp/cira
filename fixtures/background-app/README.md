# Background app fixture

An app with no web process: a worker that runs all the time and a scheduled
run, and nothing that listens on a port. It exercises what roadmap 1.6 added.

- `Procfile` declares the worker (`python worker.py`), and names no `web`
  process, which is what makes this an app with no web interface.
- `.github/workflows/weekly-report.yml` runs `report.py` every Monday at 09:00
  UTC, which Cira proposes as a scheduled run with that timetable.
- It builds with buildpacks (no Dockerfile), so its processes are started
  through the buildpacks launcher.

## Expected

| Process         | Kind      | Timetable            | Starts |
| --------------- | --------- | -------------------- | ------ |
| `worker`        | worker    | -                    | off    |
| `weekly-report` | scheduled | Mondays at 09:00 UTC | off    |

The deploy has no service and no address, and the app page says it runs in
the background. Turned on, the worker logs a heartbeat every 30 seconds, and
a run of the report prints its totals and exits 0.

```sh
cd fixtures/background-app && cira deploy
```
