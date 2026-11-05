// What a run's record means. No drawing and no side effects.
export const SEVERITIES = ["critical", "high", "medium", "low"];

export const running = (run) => (run?.stages ?? []).some((s) => s.state === "working");

export function panelShown(node, mod) {
  if (!node || node.hidden) return false;
  if (node.content?.mod === mod) return true;
  const children = node.children ?? [];
  if (node.type !== "stack") return children.some((child) => panelShown(child, mod));
  const active = children.find((child) => child.id === node.active) ?? children[0];
  return panelShown(active, mod);
}

// What a stage is doing now: its record, corrected by its live session.
export function stageStatus(stage, session) {
  if (stage.state === "working") {
    if (stage.terminal && session?.state !== "live")
      return { icon: "check-failure", color: "blocked", label: "Session ended" };
    if (session?.status === "blocked" || session?.status === "error")
      return { icon: "check-pending", color: "blocked", label: "Needs you" };
    return { icon: "spinner", color: "working", label: "Working" };
  }
  if (stage.state === "failed") return { icon: "check-failure", color: "blocked", label: "Failed" };
  if (stage.state === "stopped") return { icon: "check-skipped", color: "dim", label: "Stopped" };
  if (stage.state === "done") {
    const serious = stage.counts?.critical || stage.counts?.high;
    return serious
      ? { icon: "check-failure", color: "blocked", label: "Done" }
      : { icon: "check-success", color: "done", label: "Done" };
  }
  return { icon: "check-pending", color: "dim", label: "Queued" };
}

// Beside a stage's name. A finished one shows its result instead.
export function stageLabel(stage, status) {
  if (stage.state === "done") return null;
  if (stage.state === "queued" && stage.round) return `Checks again after ${stage.loop.with}`;
  if (stage.state === "queued")
    return stage.after?.length ? `After ${stage.after.join(", ")}` : "Waiting";
  return status.label;
}

// Findings by severity for a reviewer, the summary for the rest.
export function stageResult(stage) {
  if (stage.state !== "done") return null;
  if (stage.counts) {
    const parts = SEVERITIES.filter((severity) => stage.counts[severity]).map(
      (severity) => `${stage.counts[severity]} ${severity}`,
    );
    if (!parts.length) return "Approved";
    return (
      parts.join(", ") +
      (stage.settled ? ` · stopped after ${stage.round} round${stage.round === 1 ? "" : "s"}` : "")
    );
  }
  return (stage.summary || "Done") + (stage.replies ? ` · addressed ${stage.replies}` : "");
}

export const stageDetails = (stage) =>
  [stage.model, stage.effort, stage.role].filter(Boolean).join(" · ");

// The strip under a run's name: how far along it is, and what's in the way.
export function runStats(run) {
  const stages = run.stages ?? [];
  const done = stages.filter((s) => s.state === "done").length;
  const stats = [
    {
      key: "stages",
      label: "Stages",
      value: `${done}/${stages.length}`,
      tone: stages.length && done === stages.length ? "good" : "none",
      detail: `${done} of ${stages.length} stages done`,
    },
  ];
  const reviewed = stages.filter((s) => s.counts);
  if (reviewed.length) {
    const count = (names) =>
      reviewed.reduce(
        (sum, s) => sum + names.reduce((inner, name) => inner + (s.counts[name] ?? 0), 0),
        0,
      );
    const open = count(SEVERITIES);
    stats.push({
      key: "findings",
      label: "Findings",
      value: String(open),
      tone: count(["critical", "high"]) ? "danger" : open ? "waiting" : "good",
      detail: open ? `${open} open in the latest review` : "The latest review found nothing",
    });
  }
  const looping = stages.find((s) => s.loop && s.round > 0);
  if (looping)
    stats.push({
      key: "round",
      label: "Round",
      value: `${looping.round}/${looping.loop.max}`,
      tone: "none",
      detail: `${looping.id} is on round ${looping.round} of ${looping.loop.max}`,
    });
  return stats;
}

export function findingGroups(result) {
  const findings = result?.findings ?? [];
  const known = SEVERITIES.map((severity) => ({
    severity,
    findings: findings.filter((f) => f.severity === severity),
  }));
  const other = findings.filter((f) => !SEVERITIES.includes(f.severity));
  return [...known, { severity: "other", findings: other }].filter((g) => g.findings.length);
}

// Newest first, narrowed to one stage's events or the run's own.
export function eventsFor(run, filter) {
  const events = [...(run?.events ?? [])].reverse();
  if (filter === "all") return events;
  return events.filter((e) => (filter === "run" ? !e.stage : e.stage === filter));
}

export const chain = (workflow) => workflow.stages.map((s) => s.id).join(" → ");
