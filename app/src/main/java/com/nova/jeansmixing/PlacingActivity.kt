package com.nova.jeansmixing

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.text.InputType
import android.text.SpannableString
import android.text.Spanned
import android.text.TextUtils
import android.text.style.ForegroundColorSpan
import android.text.style.UnderlineSpan
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Part 2 — the placing/packing guide. One size at a time, in entry order.
 *
 * Guiding principle: "input follows reality — nothing is tapped until physically
 * done." The append-only press log is the single source of truth; per-size placed
 * counts, per-box counts and the next-box pointer are derived by replaying it.
 */
class PlacingActivity : AppCompatActivity() {

    private lateinit var project: Project
    private var nboxes: Int = 0
    private var current: Int = 0

    private lateinit var placingView: LinearLayout
    private lateinit var completeView: LinearLayout
    private lateinit var subtitle: TextView
    private lateinit var bundleLayerView: TextView
    private lateinit var flipCue: TextView
    private lateinit var sizeBig: TextView
    private lateinit var placedView: TextView
    private lateinit var add1: Button
    private lateinit var add5: Button
    private lateinit var add10: Button
    private lateinit var undoButton: Button
    private lateinit var leftArrow: Button
    private lateinit var rightArrow: Button
    private lateinit var doneSizeButton: Button
    private lateinit var timelineRows: LinearLayout
    private lateinit var timelineScroll: ScrollView
    private lateinit var completeRows: LinearLayout
    private lateinit var completeTotal: TextView

    private val timeFmt = SimpleDateFormat("HH:mm:ss", Locale.US)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_placing)

        val fileName = intent.getStringExtra("projectFile")
        if (fileName == null) {
            finish()
            return
        }
        val loaded = ProjectStore.load(this, fileName)
        if (loaded == null || !loaded.locked) {
            finish()
            return
        }
        project = loaded
        nboxes = DealLogic.boxes(project)
        if (nboxes <= 0) {
            finish()
            return
        }

        placingView = findViewById(R.id.placingView)
        completeView = findViewById(R.id.completeView)
        subtitle = findViewById(R.id.placingSubtitle)
        bundleLayerView = findViewById(R.id.bundleLayerView)
        flipCue = findViewById(R.id.flipCue)
        sizeBig = findViewById(R.id.sizeBig)
        placedView = findViewById(R.id.placedView)
        add1 = findViewById(R.id.add1)
        add5 = findViewById(R.id.add5)
        add10 = findViewById(R.id.add10)
        undoButton = findViewById(R.id.undoButton)
        leftArrow = findViewById(R.id.placeLeft)
        rightArrow = findViewById(R.id.placeRight)
        doneSizeButton = findViewById(R.id.placeDone)
        timelineRows = findViewById(R.id.timelineRows)
        timelineScroll = findViewById(R.id.timelineScroll)
        completeRows = findViewById(R.id.completeRows)
        completeTotal = findViewById(R.id.completeTotal)

        findViewById<Button>(R.id.boxMenuButton).setOnClickListener { onBoxMenu() }
        findViewById<Button>(R.id.staplingButton).setOnClickListener { onStapling() }
        sizeBig.setOnClickListener { onSizeJump() }
        placedView.setOnClickListener { onPlacedTap() }
        add1.setOnClickListener { onAdd(1) }
        add5.setOnClickListener { onAdd(5) }
        add10.setOnClickListener { onAdd(10) }
        undoButton.setOnClickListener { onUndo() }
        leftArrow.setOnClickListener { onArrow(-1) }
        rightArrow.setOnClickListener { onArrow(1) }
        doneSizeButton.setOnClickListener { onSizeDone() }
        findViewById<Button>(R.id.reviewSizesButton).setOnClickListener {
            current = 0
            render()
        }
        findViewById<Button>(R.id.completeBack).setOnClickListener { finish() }

        current = firstOpenSize()
        render()
    }

    override fun onResume() {
        super.onResume()
        val reloaded = ProjectStore.load(this, project.fileName)
        if (reloaded == null) {
            finish()
            return
        }
        project = reloaded
        nboxes = DealLogic.boxes(project)
        if (nboxes <= 0) {
            finish()
            return
        }
        if (current > project.entries.size) current = firstOpenSize()
        render()
    }

    /** First size that isn't finished yet; entries.size means "show the summary". */
    private fun firstOpenSize(): Int {
        for (i in project.entries.indices) {
            if (i !in project.doneSizes) return i
        }
        return project.entries.size
    }

    private fun prettySize(e: SizeEntry): String =
        "${e.waist} x ${if (e.length == "00") "ODD" else e.length}"

    // ------------------------------------------------------------------ render

    private fun render() {
        if (current >= project.entries.size) {
            showComplete()
            return
        }
        placingView.visibility = View.VISIBLE
        completeView.visibility = View.GONE

        val replay = DealLogic.replay(project)
        val entry = project.entries[current]
        val placed = replay.placedPerSize[current]
        val needed = entry.quantity

        subtitle.text = "${project.name} • Size ${current + 1} of ${project.entries.size}"
        sizeBig.text = prettySize(entry)

        // "13 out of 24 placed (11 left)". If overplaced, the placed number
        // renders RED and UNDERLINED as a warning.
        val left = maxOf(0, needed - placed)
        val placedText = "$placed out of $needed placed ($left left)"
        val ss = SpannableString(placedText)
        if (placed > needed) {
            val end = placed.toString().length
            ss.setSpan(
                ForegroundColorSpan(Color.RED), 0, end,
                Spanned.SPAN_EXCLUSIVE_EXCLUSIVE
            )
            ss.setSpan(UnderlineSpan(), 0, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        }
        placedView.text = ss

        // Bundle/layer slot of the upcoming placement (next box in line).
        val inNextBox = replay.boxCounts[replay.nextBox]
        val boxNo = replay.nextBox + 1
        if (inNextBox >= DealLogic.BOX_CAPACITY - 1) {
            bundleLayerView.text = "top pair, box $boxNo"
            flipCue.visibility = View.GONE
        } else {
            val b = inNextBox / DealLogic.BUNDLE_SIZE + 1
            val l = inNextBox % DealLogic.BUNDLE_SIZE + 1
            bundleLayerView.text = "bundle $b, layer $l, box $boxNo"
            flipCue.visibility = if (l == DealLogic.BUNDLE_SIZE) View.VISIBLE else View.GONE
        }

        setEnabled(add1, placed < needed)
        setEnabled(add5, placed < needed)
        setEnabled(add10, placed < needed)
        setEnabled(undoButton, placed > 0)
        setEnabled(leftArrow, current > 0)
        setEnabled(rightArrow, current < project.entries.size - 1)

        renderTimeline()
    }

    private fun setEnabled(b: Button, enabled: Boolean) {
        b.isEnabled = enabled
        b.alpha = if (enabled) 1f else 0.35f
    }

    private fun renderTimeline() {
        timelineRows.removeAllViews()
        for (t in project.timeline) {
            if (t.sizeIdx != current) continue
            val tv = TextView(this)
            tv.text = "${timeFmt.format(Date(t.timeMs))} — ${t.text}"
            tv.textSize = 14f
            tv.setTextColor(getColor(R.color.ink))
            timelineRows.addView(tv)
        }
        timelineScroll.post { timelineScroll.fullScroll(View.FOCUS_DOWN) }
    }

    private fun showComplete() {
        placingView.visibility = View.GONE
        completeView.visibility = View.VISIBLE
        val replay = DealLogic.replay(project)
        completeRows.removeAllViews()
        for ((i, e) in project.entries.withIndex()) {
            val row = layoutInflater.inflate(R.layout.row_locked, completeRows, false)
            if (i % 2 == 1) row.setBackgroundColor(getColor(R.color.row_yellow))
            row.findViewById<TextView>(R.id.lockSize).text = prettySize(e)
            row.findViewById<TextView>(R.id.lockQty).text =
                "${replay.placedPerSize[i]} / ${e.quantity}"
            completeRows.addView(row)
        }
        completeTotal.text =
            "${replay.placedPerSize.sum()} / ${project.entries.sumOf { it.quantity }} pairs placed"
    }

    // ------------------------------------------------------------------ actions

    /** +1/+5/+10: record N placements into the next N boxes. Caps at remaining. */
    private fun onAdd(n: Int) {
        val replay = DealLogic.replay(project)
        val remaining = project.entries[current].quantity - replay.placedPerSize[current]
        if (remaining <= 0) return
        val actual = minOf(n, remaining)
        val now = System.currentTimeMillis()
        project.placingEvents.add(PressEvent(current, actual, now))
        project.timeline.add(TimelineEntry(current, now, "+$actual"))
        ProjectStore.save(this, project)
        render()
    }

    /** Undo: remove this size's most recent press. No-op at 0 placed. */
    private fun onUndo() {
        val idx = project.placingEvents.indexOfLast { it.sizeIdx == current }
        if (idx < 0) return
        val removed = project.placingEvents.removeAt(idx)
        val now = System.currentTimeMillis()
        project.timeline.add(TimelineEntry(current, now, "undo +${removed.count}"))
        syncDone()
        ProjectStore.save(this, project)
        render()
    }

    private fun onArrow(dir: Int) {
        val next = (current + dir).coerceIn(0, project.entries.size - 1)
        if (next != current) {
            current = next
            render()
        }
    }

    /**
     * Tapping "X out of Y": pure counter correction. Sets placed to the typed
     * value and rewinds/appends the box model to match; never cascades — the
     * shortfall cascade lives only in the per-size Done popup.
     */
    private fun onPlacedTap() {
        val entry = project.entries[current]
        val placed = DealLogic.replay(project).placedPerSize[current]
        val input = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_NUMBER
            setText(placed.toString())
            setSelection(text.length)
        }
        AlertDialog.Builder(this)
            .setTitle(getString(R.string.set_placed))
            .setMessage("${prettySize(entry)} — how many are actually placed?")
            .setView(input)
            .setPositiveButton("OK") { _, _ ->
                val v = input.text.toString().toIntOrNull() ?: return@setPositiveButton
                // Lower bound 0 only: overplacement (v > needed) is allowed now.
                applyManualEdit(v.coerceAtLeast(0))
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun applyManualEdit(newVal: Int) {
        val old = DealLogic.replay(project).placedPerSize[current]
        if (newVal == old) return
        val now = System.currentTimeMillis()
        if (newVal > old) {
            project.placingEvents.add(PressEvent(current, newVal - old, now))
        } else {
            removePlacements(current, old - newVal)
        }
        project.timeline.add(TimelineEntry(current, now, "set $old → $newVal (manual)"))
        syncDone()
        ProjectStore.save(this, project)
        render()
    }

    /** Surgically removes a size's K most recent placements from the log. */
    private fun removePlacements(sizeIdx: Int, k: Int) {
        var remaining = k
        val it = project.placingEvents.listIterator(project.placingEvents.size)
        while (it.hasPrevious() && remaining > 0) {
            val e = it.previous()
            if (e.sizeIdx == sizeIdx) {
                if (e.count <= remaining) {
                    remaining -= e.count
                    it.remove()
                } else {
                    e.count -= remaining
                    remaining = 0
                }
            }
        }
    }

    /** A size whose placed < needed is never "done" (e.g. after undo/edit). */
    private fun syncDone() {
        val replay = DealLogic.replay(project)
        for (i in project.entries.indices) {
            if (replay.placedPerSize[i] < project.entries[i].quantity) {
                project.doneSizes.remove(i)
            }
        }
    }

    /** Per-size Done: advance, or handle a shortfall / overplacement via popup. */
    private fun onSizeDone() {
        val replay = DealLogic.replay(project)
        val placed = replay.placedPerSize[current]
        val needed = project.entries[current].quantity
        when {
            placed < needed -> {
                AlertDialog.Builder(this)
                    .setTitle("Shortfall?")
                    .setMessage("You only placed $placed out of $needed. Are you sure?")
                    .setPositiveButton("Yes") { _, _ -> acceptShortfall(placed, needed) }
                    .setNegativeButton("No", null)
                    .show()
            }
            placed > needed -> onOverplacement(placed, needed)
            else -> {
                project.doneSizes.add(current)
                ProjectStore.save(this, project)
                current++
                render()
            }
        }
    }

    /**
     * Overplacement: the user placed more than needed. Offer to subtract the
     * excess from the next size's needed (the boxes still fill evenly, since the
     * extra pairs physically exist). Last size: warn and let them keep it —
     * they handle it IRL, like a last-size shortfall.
     */
    private fun onOverplacement(placed: Int, needed: Int) {
        val excess = placed - needed
        if (current >= project.entries.size - 1) {
            AlertDialog.Builder(this)
                .setTitle("Extra pairs")
                .setMessage(
                    "$excess extra, but there's no next size — " +
                            "the total won't fill boxes evenly."
                )
                .setPositiveButton("Keep it") { _, _ ->
                    project.doneSizes.add(current)
                    ProjectStore.save(this, project)
                    current++
                    render()
                }
                .setNegativeButton("Fix it", null)
                .show()
        } else {
            val nextLabel = prettySize(project.entries[current + 1])
            AlertDialog.Builder(this)
                .setTitle("Extra pairs")
                .setMessage(
                    "You placed $placed, but $needed were needed — $excess extra. " +
                            "Subtract $excess from $nextLabel?"
                )
                .setPositiveButton("Yes") { _, _ ->
                    project.entries[current + 1].quantity -= excess
                    project.doneSizes.add(current)
                    syncDone()
                    ProjectStore.save(this, project)
                    current++
                    render()
                }
                .setNegativeButton("Fix it", null)
                .show()
        }
    }

    /**
     * Controlled edit of the locked plan: this size's needed := placed, the
     * shortfall moves to the NEXT size's needed (total preserved, box math stays
     * valid). Last size: just accept, the user handles it IRL.
     */
    private fun acceptShortfall(placed: Int, needed: Int) {
        val shortfall = needed - placed
        project.entries[current].quantity = placed
        if (current < project.entries.size - 1) {
            project.entries[current + 1].quantity += shortfall
        }
        project.doneSizes.add(current)
        syncDone()
        ProjectStore.save(this, project)
        current++
        render()
    }

    // ------------------------------------------------------------------ box menu

    private fun onBoxMenu() {
        val labels = Array(nboxes) { i -> "Box ${i + 1}" }
        AlertDialog.Builder(this)
            .setTitle(getString(R.string.pick_a_box))
            .setItems(labels) { _, which ->
                startActivity(
                    Intent(this, BoxDetailActivity::class.java)
                        .putExtra("projectFile", project.fileName)
                        .putExtra("boxIdx", which)
                )
            }
            .show()
    }

    /** Stapling screen for the current size (price tags). No +1/+5/+10 here. */
    private fun onStapling() {
        startActivity(
            Intent(this, StaplingActivity::class.java)
                .putExtra("projectFile", project.fileName)
                .putExtra("sizeIdx", current)
        )
    }

    /**
     * Tap the big size text: popup list of every size in entry order, each with
     * "x out of y placed (z left)" (x red when overplaced). Tap a row to jump
     * straight to that size's placing screen.
     */
    private fun onSizeJump() {
        val replay = DealLogic.replay(project)
        val rows = project.entries.mapIndexed { i, e ->
            val placed = replay.placedPerSize[i]
            val needed = e.quantity
            val left = maxOf(0, needed - placed)
            val body = "$placed out of $needed placed ($left left)"
            val ss = SpannableString(body)
            if (placed > needed) {
                ss.setSpan(
                    ForegroundColorSpan(Color.RED), 0, placed.toString().length,
                    Spanned.SPAN_EXCLUSIVE_EXCLUSIVE
                )
            }
            TextUtils.concat("${prettySize(e)} — ", ss)
        }.toTypedArray()
        AlertDialog.Builder(this)
            .setTitle(getString(R.string.jump_to_size))
            .setItems(rows) { dialog, which ->
                current = which
                render()
                dialog.dismiss()
            }
            .setNegativeButton("Cancel", null)
            .show()
    }
}
