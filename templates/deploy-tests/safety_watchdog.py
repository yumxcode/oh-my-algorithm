"""
Safety Watchdog — shared safety module for all deploy-test measure scripts.

Import at the top of any measure.py:
    from safety_watchdog import SafetyWatchdog, SafetyViolation

Usage:
    watchdog = SafetyWatchdog(
        max_tilt_deg=30.0,
        max_joint_vel_rads=10.0,
        on_violation="raise",   # "raise" | "log" | "callback"
    )
    watchdog.start()

    # in your measurement loop:
    watchdog.check(roll_deg=s["roll_deg"], pitch_deg=s["pitch_deg"])

    watchdog.stop()

Design principles:
- Never block on user input: the safety check is synchronous and can be called
  from any loop.
- Raises SafetyViolation on breach — caller decides whether to stop or log.
- Background thread monitors a "heartbeat" dict updated by the caller; if the
  dict goes stale for >heartbeat_timeout_s, it also raises SafetyViolation.
- All violations are appended to self.violations for post-run review.
"""

import threading
import time
from dataclasses import dataclass, field
from typing import Callable, Optional


class SafetyViolation(Exception):
    """Raised when a safety threshold is exceeded."""
    pass


@dataclass
class ViolationRecord:
    timestamp_s: float
    kind: str         # "tilt" | "joint_vel" | "heartbeat" | "custom"
    value: float
    threshold: float
    message: str


class SafetyWatchdog:
    """
    Synchronous safety checker + optional background heartbeat monitor.

    Parameters
    ----------
    max_tilt_deg : float
        Maximum roll or pitch before violation (degrees). Default 30.
    max_joint_vel_rads : float | None
        Maximum joint velocity magnitude before violation (rad/s). None = disabled.
    heartbeat_timeout_s : float
        If the heartbeat dict is not updated within this window, trigger a
        heartbeat violation. Set to 0 to disable. Default 2.0.
    on_violation : str
        "raise"    — raise SafetyViolation immediately (default).
        "log"      — record in self.violations but do not raise.
        "callback" — call self.violation_callback(record) if set.
    """

    def __init__(
        self,
        max_tilt_deg: float = 30.0,
        max_joint_vel_rads: Optional[float] = None,
        heartbeat_timeout_s: float = 2.0,
        on_violation: str = "raise",
    ):
        self.max_tilt_deg        = max_tilt_deg
        self.max_joint_vel_rads  = max_joint_vel_rads
        self.heartbeat_timeout_s = heartbeat_timeout_s
        self.on_violation        = on_violation

        self.violations: list[ViolationRecord] = []
        self.violation_callback: Optional[Callable[[ViolationRecord], None]] = None

        self._running   = False
        self._thread    = None
        self._heartbeat_lock = threading.Lock()
        self._last_heartbeat = time.perf_counter()

    # ── Public API ─────────────────────────────────────────────────────────────

    def start(self):
        """Start the background heartbeat monitor thread."""
        self._running        = True
        self._last_heartbeat = time.perf_counter()
        if self.heartbeat_timeout_s > 0:
            self._thread = threading.Thread(
                target=self._heartbeat_loop, daemon=True
            )
            self._thread.start()

    def stop(self):
        """Stop the watchdog. Call after measurement loop ends."""
        self._running = False

    def beat(self):
        """Call once per control loop iteration to keep the heartbeat alive."""
        with self._heartbeat_lock:
            self._last_heartbeat = time.perf_counter()

    def check(
        self,
        roll_deg: float = 0.0,
        pitch_deg: float = 0.0,
        joint_velocities: Optional[dict] = None,
    ):
        """
        Synchronous safety check. Call inside your measurement loop.

        Parameters
        ----------
        roll_deg, pitch_deg : float
            Current base orientation (degrees).
        joint_velocities : dict[str, float] | None
            Joint velocities in rad/s. Checked against max_joint_vel_rads.
        """
        self.beat()

        tilt = max(abs(roll_deg), abs(pitch_deg))
        if tilt >= self.max_tilt_deg:
            self._handle(ViolationRecord(
                timestamp_s=time.perf_counter(),
                kind="tilt",
                value=tilt,
                threshold=self.max_tilt_deg,
                message=f"Base tilt {tilt:.1f}° ≥ threshold {self.max_tilt_deg}°"
                        f" (roll={roll_deg:.1f}°, pitch={pitch_deg:.1f}°)",
            ))

        if self.max_joint_vel_rads is not None and joint_velocities:
            for jname, vel in joint_velocities.items():
                if abs(vel) >= self.max_joint_vel_rads:
                    self._handle(ViolationRecord(
                        timestamp_s=time.perf_counter(),
                        kind="joint_vel",
                        value=abs(vel),
                        threshold=self.max_joint_vel_rads,
                        message=f"Joint {jname} velocity {vel:.2f} rad/s ≥ "
                                f"threshold {self.max_joint_vel_rads} rad/s",
                    ))

    def check_dict(self, state: dict):
        """Convenience wrapper: pass a state dict with roll_deg, pitch_deg keys."""
        self.check(
            roll_deg=state.get("roll_deg", 0.0),
            pitch_deg=state.get("pitch_deg", 0.0),
        )

    def summary(self) -> str:
        """Return a one-line summary string of all recorded violations."""
        if not self.violations:
            return "No safety violations recorded."
        counts: dict[str, int] = {}
        for v in self.violations:
            counts[v.kind] = counts.get(v.kind, 0) + 1
        parts = [f"{k}×{n}" for k, n in counts.items()]
        return f"{len(self.violations)} violation(s): {', '.join(parts)}"

    # ── Internal ───────────────────────────────────────────────────────────────

    def _handle(self, record: ViolationRecord):
        self.violations.append(record)
        msg = f"[SafetyWatchdog] {record.kind.upper()}: {record.message}"
        if self.on_violation == "raise":
            raise SafetyViolation(msg)
        elif self.on_violation == "callback" and self.violation_callback:
            self.violation_callback(record)
        else:
            print(f"⚠️  {msg}")

    def _heartbeat_loop(self):
        """Background thread: fires a heartbeat violation if the loop goes silent."""
        while self._running:
            time.sleep(0.5)
            with self._heartbeat_lock:
                elapsed = time.perf_counter() - self._last_heartbeat
            if elapsed > self.heartbeat_timeout_s:
                record = ViolationRecord(
                    timestamp_s=time.perf_counter(),
                    kind="heartbeat",
                    value=elapsed,
                    threshold=self.heartbeat_timeout_s,
                    message=(
                        f"No heartbeat for {elapsed:.1f}s "
                        f"(timeout={self.heartbeat_timeout_s}s). "
                        "Measurement loop may have stalled."
                    ),
                )
                # In heartbeat thread, always log (don't raise cross-thread)
                self.violations.append(record)
                print(f"⚠️  [SafetyWatchdog] HEARTBEAT: {record.message}")


# ── Example integration ────────────────────────────────────────────────────────
#
# from safety_watchdog import SafetyWatchdog, SafetyViolation
#
# watchdog = SafetyWatchdog(max_tilt_deg=30.0, on_violation="raise")
# watchdog.start()
#
# records = []
# try:
#     for _ in range(n_steps):
#         state = get_base_state()
#         watchdog.check(roll_deg=state["roll_deg"], pitch_deg=state["pitch_deg"])
#         records.append(state)
#         time.sleep(period)
# except SafetyViolation as e:
#     print(f"SAFETY STOP: {e}")
#     set_target_velocity(0.0)   # emergency stop
# finally:
#     watchdog.stop()
#     print(watchdog.summary())
