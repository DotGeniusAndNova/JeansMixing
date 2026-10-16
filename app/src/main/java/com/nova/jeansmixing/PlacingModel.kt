package com.nova.jeansmixing

/**
 * Part 2 — placing/packing model.
 *
 * The press log is append-only: every +1/+5/+10 tap records (sizeIdx, count, time).
 * Per-size placed counts, per-box pair counts and the next-box pointer are all
 * derived by replaying the log in order, so corrections (undo, manual edits)
 * just mutate the log and everything stays consistent.
 */

/** One +1/+5/+10 press: which size, how many pairs, when. */
data class PressEvent(var sizeIdx: Int, var count: Int, var timeMs: Long)

/** One row in a size's history timeline. */
data class TimelineEntry(var sizeIdx: Int, var timeMs: Long, var text: String)

object DealLogic {
    const val BOX_CAPACITY = 25
    const val BUNDLE_SIZE = 6

    data class Replay(
        val placedPerSize: IntArray,
        val boxCounts: IntArray,
        val nextBox: Int
    )

    /** Boxes implied by the current plan; -1 if the total isn't divisible by 25. */
    fun boxCount(project: Project): Int {
        val total = project.entries.sumOf { it.quantity }
        return if (total % BOX_CAPACITY == 0) total / BOX_CAPACITY else -1
    }

    /**
     * The physical box count. Frozen at lock time (lockedBoxCount) because the
     * plan total can stop being divisible by 25 after overplacement cascades —
     * the excess pairs physically exist while later "needed" labels shrink.
     * Old projects without a frozen count fall back to the plan derivation.
     */
    fun boxes(project: Project): Int {
        val frozen = project.lockedBoxCount
        return if (frozen > 0) frozen else boxCount(project).coerceAtLeast(1)
    }

    /** Replays the press log in order. */
    fun replay(project: Project): Replay {
        val nboxes = boxes(project)
        val placed = IntArray(project.entries.size)
        val boxCounts = IntArray(nboxes)
        var pointer = 0
        for (e in project.placingEvents) {
            if (e.sizeIdx !in placed.indices || e.count <= 0) continue
            placed[e.sizeIdx] += e.count
            repeat(e.count) {
                boxCounts[pointer]++
                pointer = (pointer + 1) % nboxes
            }
        }
        return Replay(placed, boxCounts, pointer)
    }

    /**
     * Full expected dealing from the CURRENT plan: for each box, the size indices
     * in placement order. Deterministic round-robin from box 1 — recompute live,
     * never cache.
     */
    fun simulate(project: Project): List<List<Int>> {
        val nboxes = boxes(project)
        val boxes = MutableList(nboxes) { mutableListOf<Int>() }
        var b = 0
        for ((si, e) in project.entries.withIndex()) {
            repeat(e.quantity) {
                boxes[b].add(si)
                b = (b + 1) % nboxes
            }
        }
        return boxes
    }

    /**
     * LIVE box contents: ACTUAL placements from the event log (in order), PLUS
     * the remaining plan simulated round-robin from the current next-box pointer,
     * where remaining[i] = max(0, needed[i] - placed[i]) in size order.
     * Stays exact even with overplacement, where a pure plan simulation diverges
     * (actuals can exceed the original plan). Recompute live, never cache.
     */
    fun simulateLive(project: Project): List<List<Int>> {
        val nboxes = boxes(project)
        val out = MutableList(nboxes) { mutableListOf<Int>() }
        var b = 0
        for (e in project.placingEvents) {
            if (e.sizeIdx !in project.entries.indices || e.count <= 0) continue
            repeat(e.count) {
                out[b].add(e.sizeIdx)
                b = (b + 1) % nboxes
            }
        }
        val replay = replay(project)
        // b == replay.nextBox here: the log above is replayed identically.
        for ((si, entry) in project.entries.withIndex()) {
            val rem = maxOf(0, entry.quantity - replay.placedPerSize[si])
            repeat(rem) {
                out[b].add(si)
                b = (b + 1) % nboxes
            }
        }
        return out
    }

    fun totalPlaced(project: Project): Int = project.placingEvents.sumOf { it.count }
}
